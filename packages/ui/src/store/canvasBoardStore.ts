import { create } from "zustand";
import {
  buildCanvasBoardWorkspaceKey,
  CANVAS_BOARD_LIMIT,
  CANVAS_EDGE_LIMIT,
  CANVAS_NODE_LIMIT,
  clampCanvasBoardName,
  createCanvasBoardId,
  createCanvasNoteNode,
  parseCanvasBoardDocument,
  readCanvasBoardDocument,
  readCanvasIndex,
  removeCanvasBoardDocument,
  writeCanvasBoardDocument,
  writeCanvasIndex,
  type CanvasBoardDocument,
  type CanvasBoardMeta,
  type CanvasIndex,
  type CanvasNodePosition,
  type CanvasViewport,
} from "@/lib/canvasBoard.js";
import { shouldExposeE2EStoreBridge } from "@/lib/e2eStoreBridge.js";

export interface CanvasBoardScope {
  workspacePath: string;
  workspaceIdentity?: string;
  boardId?: string;
}

interface CanvasWorkspaceState {
  index: CanvasIndex;
  /** 已装载的文档（编辑器打开过才在缓存里）；首页只消费 index。 */
  docs: Record<string, CanvasBoardDocument>;
}

interface CanvasBoardStoreState {
  workspaces: Record<string, CanvasWorkspaceState>;
  loadWorkspace: (params: Omit<CanvasBoardScope, "boardId">) => void;
  createBoard: (params: Omit<CanvasBoardScope, "boardId"> & { name: string }) => CanvasBoardMeta | null;
  openBoard: (params: CanvasBoardScope) => CanvasBoardDocument | null;
  deleteBoard: (params: CanvasBoardScope) => void;
  addNote: (params: CanvasBoardScope & { position: CanvasNodePosition }) => string | null;
  updateNoteText: (params: CanvasBoardScope & { nodeId: string; text: string }) => void;
  /** 拖动过程高频调用：只更新内存态，落盘统一交给 persistBoard（onNodeDragStop）。 */
  moveNode: (params: CanvasBoardScope & { nodeId: string; position: CanvasNodePosition }) => void;
  removeNodes: (params: CanvasBoardScope & { nodeIds: readonly string[] }) => void;
  addConnection: (params: CanvasBoardScope & { source: string; target: string }) => void;
  removeEdges: (params: CanvasBoardScope & { edgeIds: readonly string[] }) => void;
  setViewport: (params: CanvasBoardScope & { viewport: CanvasViewport }) => void;
  persistBoard: (params: CanvasBoardScope) => void;
}

function workspaceKeyOf(params: CanvasBoardScope): string {
  return buildCanvasBoardWorkspaceKey(params);
}

function emptyWorkspace(): CanvasWorkspaceState {
  return { index: { boards: [], lastOpenedBoardId: null }, docs: {} };
}

function getIndex(state: CanvasBoardStoreState, key: string): CanvasIndex {
  return state.workspaces[key]?.index ?? { boards: [], lastOpenedBoardId: null };
}

function getDoc(
  state: CanvasBoardStoreState,
  key: string,
  boardId: string,
): CanvasBoardDocument | undefined {
  return state.workspaces[key]?.docs[boardId];
}

function boardMetaFor(
  index: CanvasIndex,
  boardId: string,
): CanvasBoardMeta | undefined {
  return index.boards.find((board) => board.id === boardId);
}

function withWorkspace(
  state: CanvasBoardStoreState,
  key: string,
  patch: Partial<CanvasWorkspaceState>,
): Pick<CanvasBoardStoreState, "workspaces"> {
  const current = state.workspaces[key] ?? emptyWorkspace();
  return { workspaces: { ...state.workspaces, [key]: { ...current, ...patch } } };
}

function withIndex(
  state: CanvasBoardStoreState,
  params: CanvasBoardScope,
  mutate: (index: CanvasIndex) => CanvasIndex,
): Pick<CanvasBoardStoreState, "workspaces"> {
  const key = workspaceKeyOf(params);
  const index = getIndex(state, key);
  const next = mutate(index);
  writeCanvasIndex(key, next);
  return withWorkspace(state, key, { index: next });
}

function withDoc(
  state: CanvasBoardStoreState,
  params: CanvasBoardScope,
  mutate: (document: CanvasBoardDocument) => CanvasBoardDocument,
  options: { persist?: boolean } = {},
): Pick<CanvasBoardStoreState, "workspaces"> {
  // boardId 缺失时无法定位文档，直接返回原状态（调用方已各自 guard，这里是兜底）。
  if (!params.boardId) {
    return state;
  }
  const key = workspaceKeyOf(params);
  const document = getDoc(state, key, params.boardId) ?? readCanvasBoardDocument(key, params.boardId);
  if (!document) {
    return state;
  }
  const next = mutate(document);
  if (options.persist !== false) {
    writeCanvasBoardDocument(key, next);
  }
  const boardId = params.boardId;
  const index = getIndex(state, key);
  const meta = boardMetaFor(index, boardId);
  const nextIndex: CanvasIndex = meta
    ? { ...index, boards: index.boards.map((board) => (board.id === boardId ? { ...board, updatedAt: next.updatedAt } : board)) }
    : index;
  if (meta) {
    writeCanvasIndex(key, nextIndex);
  }
  return withWorkspace(state, key, { index: nextIndex, docs: { ...state.workspaces[key]?.docs, [boardId]: next } });
}

export const useCanvasBoardStore = create<CanvasBoardStoreState>()((set, get) => ({
  workspaces: {},
  loadWorkspace: (params) => {
    const key = workspaceKeyOf(params);
    // 已装载的 workspace 不重读磁盘，避免覆盖运行时未落盘的拖动位置。
    if (get().workspaces[key]) {
      return;
    }
    const index = readCanvasIndex(key);
    const lastDoc = index.lastOpenedBoardId
      ? readCanvasBoardDocument(key, index.lastOpenedBoardId)
      : null;
    const docs = lastDoc ? { [lastDoc.id]: lastDoc } : {};
    set((state) => withWorkspace(state, key, { index, docs }));
  },
  createBoard: (params) => {
    const key = workspaceKeyOf(params);
    const index = getIndex(get(), key);
    if (index.boards.length >= CANVAS_BOARD_LIMIT) {
      return null;
    }
    const meta: CanvasBoardMeta = {
      id: createCanvasBoardId(),
      name: clampCanvasBoardName(params.name),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const document = parseCanvasBoardDocument({}, { id: meta.id, name: meta.name });
    writeCanvasBoardDocument(key, document);
    // 新建画布置顶，并作为最近打开项。
    set((state) =>
      withIndex(state, params, (current) => ({
        boards: [{ ...meta }, ...current.boards].slice(0, CANVAS_BOARD_LIMIT),
        lastOpenedBoardId: meta.id,
      })),
    );
    set((state) =>
      withWorkspace(state, key, {
        docs: { ...state.workspaces[key]?.docs, [meta.id]: document },
      }),
    );
    return meta;
  },
  openBoard: (params) => {
    if (!params.boardId) {
      return null;
    }
    const key = workspaceKeyOf(params);
    const state = get();
    const index = getIndex(state, key);
    const meta = boardMetaFor(index, params.boardId);
    if (!meta) {
      return null;
    }
    const cached = getDoc(state, key, params.boardId);
    const document =
      cached ??
      (() => {
        const loaded = readCanvasBoardDocument(key, params.boardId);
        return loaded ? parseCanvasBoardDocument(loaded, { id: meta.id, name: meta.name }) : null;
      })();
    if (!document) {
      // 索引存在而文档缺失（写入失败/被清理）：以空文档自愈，避免卡片僵死。
      const healed = parseCanvasBoardDocument({}, { id: meta.id, name: meta.name });
      writeCanvasBoardDocument(key, healed);
      set((s) =>
        withIndex(s, params, (current) => ({
          ...current,
          lastOpenedBoardId: meta.id,
        })),
      );
      set((s) =>
        withWorkspace(s, key, { docs: { ...s.workspaces[key]?.docs, [meta.id]: healed } }),
      );
      return healed;
    }
    set((s) =>
      withIndex(s, params, (current) => ({ ...current, lastOpenedBoardId: meta.id })),
    );
    set((s) =>
      withWorkspace(s, key, { docs: { ...s.workspaces[key]?.docs, [meta.id]: document } }),
    );
    return document;
  },
  deleteBoard: (params) => {
    if (!params.boardId) {
      return;
    }
    const key = workspaceKeyOf(params);
    const boardId = params.boardId;
    removeCanvasBoardDocument(key, boardId);
    set((s) => {
      const patched = withIndex(s, params, (current) => ({
        boards: current.boards.filter((board) => board.id !== boardId),
        lastOpenedBoardId:
          current.lastOpenedBoardId === boardId ? null : current.lastOpenedBoardId,
      }));
      const current = s.workspaces[key] ?? emptyWorkspace();
      const docs = { ...current.docs };
      delete docs[boardId];
      return {
        workspaces: {
          ...patched.workspaces,
          [key]: { ...(patched.workspaces[key] ?? current), docs },
        },
      };
    });
  },
  addNote: (params) => {
    if (!params.boardId) {
      return null;
    }
    const state = get();
    const scopedParams = { ...params, boardId: params.boardId };
    const key = workspaceKeyOf(scopedParams);
    const doc = getDoc(state, key, params.boardId);
    if (!doc || doc.nodes.length >= CANVAS_NODE_LIMIT) {
      return null;
    }
    const node = createCanvasNoteNode(params.position);
    set((s) =>
      withDoc(s, scopedParams, (document) => ({
        ...document,
        nodes: [...document.nodes, node],
      })),
    );
    return node.id;
  },
  updateNoteText: (params) => {
    if (!params.boardId) return;
    set((s) =>
      withDoc(s, params, (document) => ({
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === params.nodeId ? { ...node, data: { ...node.data, text: params.text } } : node,
        ),
      })),
    );
  },
  moveNode: (params) => {
    if (!params.boardId) return;
    const { boardId } = params;
    // 拖动中的高频路径：只 set 不写盘、不刷新 updatedAt，落盘延迟到 onNodeDragStop。
    const key = buildCanvasBoardWorkspaceKey(params);
    set((state) => {
      const document = state.workspaces[key]?.docs[boardId];
      if (!document) {
        return state;
      }
      return withDoc(state, params, (current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === params.nodeId
            ? { ...node, position: { x: params.position.x, y: params.position.y } }
            : node,
        ),
      }), { persist: false });
    });
  },
  removeNodes: (params) => {
    if (!params.boardId) return;
    const removed = new Set(params.nodeIds);
    if (removed.size === 0) {
      return;
    }
    set((s) =>
      withDoc(s, params, (document) => ({
        ...document,
        nodes: document.nodes.filter((node) => !removed.has(node.id)),
        // 级联清理指向已删节点的边，避免产生孤儿边。
        edges: document.edges.filter(
          (edge) => !removed.has(edge.source) && !removed.has(edge.target),
        ),
      })),
    );
  },
  addConnection: (params) => {
    if (!params.boardId) return;
    const state = get();
    const key = workspaceKeyOf(params);
    const document = getDoc(state, key, params.boardId);
    if (!document) {
      return;
    }
    const nodeIds = new Set(document.nodes.map((node) => node.id));
    if (!nodeIds.has(params.source) || !nodeIds.has(params.target)) {
      return;
    }
    set((s) =>
      withDoc(s, params, (current) => ({
        ...current,
        // 同向边去重（保留新连出的这份），并受上限约束。
        edges: [
          ...current.edges.filter(
            (edge) => !(edge.source === params.source && edge.target === params.target),
          ),
          {
            id: `canvas-edge-${crypto.randomUUID()}`,
            source: params.source,
            target: params.target,
          },
          ].slice(-CANVAS_EDGE_LIMIT),
      })),
    );
  },
  removeEdges: (params) => {
    if (!params.boardId) return;
    const removed = new Set(params.edgeIds);
    if (removed.size === 0) {
      return;
    }
    set((s) =>
      withDoc(s, params, (document) => ({
        ...document,
        edges: document.edges.filter((edge) => !removed.has(edge.id)),
      })),
    );
  },
  setViewport: (params) => {
    if (!params.boardId) return;
    set((s) =>
      withDoc(s, params, (document) => ({
        ...document,
        viewport: { x: params.viewport.x, y: params.viewport.y, zoom: params.viewport.zoom },
      })),
    );
  },
  persistBoard: (params) => {
    if (!params.boardId) return;
    set((s) => withDoc(s, params, (document) => ({ ...document })));
  },
}));

type CanvasBoardStoreE2EBridge = typeof useCanvasBoardStore;

declare global {
  interface Window {
    __canvasBoardStoreE2E?: CanvasBoardStoreE2EBridge;
  }
}

if (shouldExposeE2EStoreBridge()) {
  // E2E 诊断入口必须由 WDIO 显式打开，不能复用 SHUCODE_ENV=test，避免产品测试环境暴露可变全局 store。
  window.__canvasBoardStoreE2E = useCanvasBoardStore;
}
