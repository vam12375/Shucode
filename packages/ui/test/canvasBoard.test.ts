import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanvasBoardWorkspaceKey,
  buildCanvasIndexStorageKey,
  buildCanvasDocStorageKey,
  CANVAS_BOARD_LIMIT,
  CANVAS_EDGE_LIMIT,
  CANVAS_NODE_LIMIT,
  CANVAS_NOTE_TEXT_LIMIT,
  createCanvasNoteNode,
  parseCanvasBoardDocument,
  parseCanvasIndex,
  pickDefaultBoardName,
  readCanvasIndex,
} from "../src/lib/canvasBoard.js";
import zhCN from "../src/i18n/locales/zh-CN.js";
import enUS from "../src/i18n/locales/en-US.js";

const CANVAS_I18N_IDS = [
  "workspace.openCanvas",
  "canvas.title",
  "canvas.back",
  "canvas.defaultBoardName",
  "canvas.addNote",
  "canvas.notePlaceholder",
  "canvas.emptyHint",
  "canvas.deleteNode",
  "canvas.resetView",
  "canvas.menuHome",
  "canvas.exitToChat",
  "canvas.menuNew",
  "canvas.panelTabNodes",
  "canvas.panelTabAssets",
  "canvas.panelAssetsOpen",
  "canvas.panelNodesEmpty",
  "canvas.panelAssetsEmpty",
  "canvas.panelNodeUntitled",
  "canvas.panelCollapse",
  "canvas.nodeCount",
  "canvas.actionImage",
  "canvas.actionVideo",
  "canvas.actionAudio",
  "canvas.actionScript",
  "canvas.actionEdit",
  "canvasHome.subtitle",
  "canvasHome.newTitle",
  "canvasHome.newSub",
  "canvasHome.boardLimit",
  "canvasHome.comingSoon",
  "canvasHome.modelMatrix",
  "canvasHome.modelMatrixDesc",
  "canvasHome.templateCenter",
  "canvasHome.templateCenterDesc",
  "canvasHome.wallTitle",
  "canvasHome.wallEmpty",
  "canvasHome.remove",
  "canvasHome.deleteTitle",
  "canvasHome.deleteDesc",
  "canvasHome.deleteConfirm",
  "canvasHome.statsTitle",
  "canvasHome.statsBoards",
  "canvasHome.stats7d",
  "canvasHome.taskVideo",
  "canvasHome.taskVideoDesc",
  "canvasHome.taskImage",
  "canvasHome.taskImageDesc",
  "canvasHome.taskAudio",
  "canvasHome.taskAudioDesc",
  "canvasHome.taskEdit",
  "canvasHome.taskEditDesc",
];

test("canvas index: parse tolerates non-object payloads", () => {
  for (const junk of [null, undefined, 42, "junk", []]) {
    const index = parseCanvasIndex(junk);
    assert.deepEqual(index.boards, []);
    assert.equal(index.lastOpenedBoardId, null);
  }
});

test("canvas index: drops invalid entries, dedupes ids, sorts by updatedAt desc", () => {
  const index = parseCanvasIndex({
    boards: [
      null,
      { id: "", name: "no-id" },
      { id: "b1", name: "old", updatedAt: 100, createdAt: 1 },
      { id: "b1", name: "dup", updatedAt: 200 },
      { id: "b2", name: "newest", updatedAt: 300 },
      { id: "b3" }, // 缺 name，剔除
    ],
    lastOpenedBoardId: "missing",
  });
  assert.deepEqual(
    index.boards.map((board) => board.id),
    ["b2", "b1"],
  );
  assert.equal(index.lastOpenedBoardId, null);
});

test("canvas index: clamps board count and board names", () => {
  const boards = Array.from({ length: CANVAS_BOARD_LIMIT + 10 }, (_item, i) => ({
    id: `b-${i}`,
    name: "x".repeat(200),
  }));
  const index = parseCanvasIndex({ boards });
  assert.equal(index.boards.length, CANVAS_BOARD_LIMIT);
  assert.ok(index.boards[0]?.name.length <= 80);
});

test("canvas index: read falls back to empty index without localStorage", () => {
  // node:test 环境没有 localStorage（等同 SSR/隐私模式），读路径必须安全。
  const index = readCanvasIndex("/tmp/workspace-a");
  assert.deepEqual(index.boards, []);
  assert.equal(index.lastOpenedBoardId, null);
});

test("canvas keys: index and doc keys are namespaced per workspace and board", () => {
  assert.equal(
    buildCanvasIndexStorageKey("/tmp/ws"),
    "shucode-canvas-index-%2Ftmp%2Fws",
  );
  assert.equal(
    buildCanvasDocStorageKey("/tmp/ws", "board-1"),
    "shucode-canvas-doc-%2Ftmp%2Fws-board-1",
  );
});

test("canvas document: keeps valid content and backfills meta", () => {
  const document = parseCanvasBoardDocument(
    {
      nodes: [
        { id: "node-1", type: "note", position: { x: 12.5, y: -4 }, data: { text: "hello" } },
      ],
      edges: [{ id: "edge-1", source: "node-1", target: "node-1" }],
      viewport: { x: 10, y: -20, zoom: 1.4 },
      updatedAt: 123,
    },
    { id: "board-1", name: "画布 1" },
  );
  assert.equal(document.id, "board-1");
  assert.equal(document.name, "画布 1");
  assert.equal(document.nodes.length, 1);
  assert.equal(document.nodes[0]?.data.text, "hello");
  assert.deepEqual(document.viewport, { x: 10, y: -20, zoom: 1.4 });
});

test("canvas document: bad meta falls back to provided fallback", () => {
  const document = parseCanvasBoardDocument(
    { id: "", name: 42, nodes: "junk", edges: null, viewport: { zoom: 99 } },
    { id: "board-9", name: "兜底" },
  );
  assert.equal(document.id, "board-9");
  assert.equal(document.name, "兜底");
  assert.deepEqual(document.nodes, []);
  assert.deepEqual(document.edges, []);
  assert.equal(document.viewport.zoom, 4);
});

test("canvas document: default document is empty with viewport", () => {
  const document = parseCanvasBoardDocument(undefined);
  assert.deepEqual(document.nodes, []);
  assert.deepEqual(document.edges, []);
  assert.equal(document.viewport.zoom, 1);
  assert.match(document.id, /^canvas-board-/);
});

test("canvas document: drops invalid nodes, orphan edges and duplicate ids", () => {
  const document = parseCanvasBoardDocument({
    nodes: [
      null,
      { id: "", type: "note", position: { x: 0, y: 0 }, data: {} },
      { id: "bad-pos", position: { x: Number.NaN, y: 1 }, data: {} },
      { id: "dup", type: "note", position: { x: 0, y: 0 }, data: { text: "first" } },
      { id: "dup", type: "note", position: { x: 1, y: 1 }, data: { text: "second" } },
      { id: "no-data", type: "note", position: { x: 5, y: 6 } },
    ],
    edges: [
      { id: "edge-ok", source: "dup", target: "no-data" },
      { id: "edge-orphan", source: "dup", target: "missing" },
      { id: "edge-orphan-2", source: null, target: "dup" },
    ],
  });
  assert.deepEqual(
    document.nodes.map((node) => node.id).sort(),
    ["dup", "no-data"],
  );
  assert.equal(document.nodes.find((node) => node.id === "dup")?.data.text, "first");
  assert.deepEqual(document.edges, [{ id: "edge-ok", source: "dup", target: "no-data" }]);
});

test("canvas document: clamps viewport zoom into supported range", () => {
  assert.equal(parseCanvasBoardDocument({ viewport: { zoom: 99 } }).viewport.zoom, 4);
  assert.equal(parseCanvasBoardDocument({ viewport: { zoom: 0.001 } }).viewport.zoom, 0.1);
  assert.equal(parseCanvasBoardDocument({ viewport: { zoom: "junk" } }).viewport.zoom, 1);
  assert.equal(parseCanvasBoardDocument({ viewport: { x: "junk", y: 5, zoom: 2 } }).viewport.x, 0);
});

test("canvas document: truncates oversized note text and prunes over-limit collections", () => {
  const nodes = Array.from({ length: CANVAS_NODE_LIMIT + 5 }, (_item, index) => ({
    id: `node-${index}`,
    type: "note",
    position: { x: index, y: index },
    data: { text: "x".repeat(CANVAS_NOTE_TEXT_LIMIT + 10) },
  }));
  const edges = Array.from({ length: CANVAS_EDGE_LIMIT + 50 }, (_item, index) => ({
    id: `edge-${index}`,
    source: "node-0",
    target: `node-${index % 2}`,
  }));
  const document = parseCanvasBoardDocument({ nodes, edges });
  assert.equal(document.nodes.length, CANVAS_NODE_LIMIT);
  assert.equal(document.edges.length, CANVAS_EDGE_LIMIT);
  assert.equal(document.nodes[0]?.data.text.length, CANVAS_NOTE_TEXT_LIMIT);
});

test("canvas note: defaults to note type with clamped text", () => {
  const node = createCanvasNoteNode({ x: 1, y: 2 }, "ƒ".repeat(CANVAS_NOTE_TEXT_LIMIT + 1));
  assert.match(node.id, /^canvas-node-/);
  assert.equal(node.type, "note");
  assert.equal(node.data.text.length, CANVAS_NOTE_TEXT_LIMIT);
});

test("canvas default board name: numbering picks first unused slot", () => {
  const format = (n: number) => `画布 ${n}`;
  assert.equal(pickDefaultBoardName(format, []), "画布 1");
  assert.equal(pickDefaultBoardName(format, ["画布 1"]), "画布 2");
  assert.equal(pickDefaultBoardName(format, ["画布 2", "画布 3"]), "画布 1");
  // 编号空洞（用户删除/重命名后）会被复用，不随历史数量膨胀。
  assert.equal(pickDefaultBoardName(format, ["画布 1", "画布 2", "画布 4"]), "画布 3");
});

test("canvas workspace key: identity wins over path", () => {
  assert.equal(
    buildCanvasBoardWorkspaceKey({ workspacePath: "/a", workspaceIdentity: "  remote-id " }),
    "remote-id",
  );
  assert.equal(buildCanvasBoardWorkspaceKey({ workspacePath: "/a", workspaceIdentity: "   " }), "/a");
  assert.equal(buildCanvasBoardWorkspaceKey({ workspacePath: "/a" }), "/a");
});

test("canvas i18n: every message id exists in both locales", () => {
  for (const id of CANVAS_I18N_IDS) {
    assert.ok(zhCN[id]?.length > 0, `zh-CN missing ${id}`);
    assert.ok(enUS[id]?.length > 0, `en-US missing ${id}`);
  }
});
