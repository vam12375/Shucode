import { readSafeLocalStorage, removeSafeLocalStorage, writeSafeLocalStorage } from "./browserEnvironment.js";

/** 画布节点类型；本期仅便签，为后续生成节点（Seedance 媒体卡片）预留 union 扩展位。 */
export type CanvasNodeType = "note";

export interface CanvasNodePosition {
  x: number;
  y: number;
}

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  position: CanvasNodePosition;
  data: {
    text: string;
  };
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasBoardMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasBoardDocument extends CanvasBoardMeta {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
}

export interface CanvasIndex {
  boards: CanvasBoardMeta[];
  lastOpenedBoardId: string | null;
}

export interface CanvasWorkspaceData {
  index: CanvasIndex;
  docs: Record<string, CanvasBoardDocument>;
}

/** localStorage 容量有限且无版本机制，靠防御性裁剪兜底；上限调整时旧文档由归一化自动收敛。 */
export const CANVAS_NODE_LIMIT = 500;
export const CANVAS_EDGE_LIMIT = 1000;
export const CANVAS_NOTE_TEXT_LIMIT = 2000;
export const CANVAS_BOARD_LIMIT = 50;
export const CANVAS_BOARD_NAME_LIMIT = 80;
const CANVAS_ZOOM_MIN = 0.1;
const CANVAS_ZOOM_MAX = 4;
export const CANVAS_DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };

// 索引/文档分开落盘：首页只读索引（轻），编辑器按需装载单份文档。
const CANVAS_INDEX_KEY_PREFIX = "shucode-canvas-index-";
const CANVAS_DOC_KEY_PREFIX = "shucode-canvas-doc-";
// 2026-10-15 前的旧版：每 workspace 一份无 id/name 的单文档。装载时迁移。
const CANVAS_LEGACY_BOARD_KEY_PREFIX = "shucode-canvas-board-";

export function buildCanvasBoardWorkspaceKey({
  workspacePath,
  workspaceIdentity,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
}): string {
  // 身份 key 统一规则：identity 优先，本地路径兜底（见 AGENTS.md Workspace Identity）。
  return workspaceIdentity?.trim() || workspacePath;
}

export function buildCanvasIndexStorageKey(workspaceKey: string): string {
  return `${CANVAS_INDEX_KEY_PREFIX}${encodeURIComponent(workspaceKey)}`;
}

export function buildCanvasDocStorageKey(workspaceKey: string, boardId: string): string {
  return `${CANVAS_DOC_KEY_PREFIX}${encodeURIComponent(workspaceKey)}-${encodeURIComponent(boardId)}`;
}

function buildCanvasLegacyBoardStorageKey(workspaceKey: string): string {
  return `${CANVAS_LEGACY_BOARD_KEY_PREFIX}${encodeURIComponent(workspaceKey)}`;
}

export function createEmptyCanvasBoardDocument(meta?: {
  id: string;
  name: string;
  createdAt?: number;
  updatedAt?: number;
}): CanvasBoardDocument {
  const now = Date.now();
  return {
    id: meta?.id ?? createCanvasBoardId(),
    name: meta?.name ?? "",
    createdAt: meta?.createdAt ?? now,
    updatedAt: meta?.updatedAt ?? now,
    nodes: [],
    edges: [],
    viewport: { ...CANVAS_DEFAULT_VIEWPORT },
  };
}

export function createCanvasNodeId(): string {
  return `canvas-node-${crypto.randomUUID()}`;
}

export function createCanvasBoardId(): string {
  return `canvas-board-${crypto.randomUUID()}`;
}

export function createCanvasNoteNode(
  position: CanvasNodePosition,
  text = "",
  id = createCanvasNodeId(),
): CanvasNode {
  return {
    id,
    type: "note",
    position: { x: position.x, y: position.y },
    data: { text: clampCanvasNoteText(text) },
  };
}

export function clampCanvasNoteText(text: string): string {
  return text.length > CANVAS_NOTE_TEXT_LIMIT ? text.slice(0, CANVAS_NOTE_TEXT_LIMIT) : text;
}

export function clampCanvasBoardName(name: string): string {
  const normalized = name.trim().slice(0, CANVAS_BOARD_NAME_LIMIT);
  return normalized.length > 0 ? normalized : "Canvas";
}

/**
 * 新建画布默认名：从「画布 1」起取第一个未占用编号。
 * 首页磁贴与详情页菜单共用，保证「画布 N」只有一条命名规则；
 * 删除画布释放的编号可被复用，序号不随历史数量膨胀。
 */
export function pickDefaultBoardName(
  format: (n: number) => string,
  existingNames: readonly string[],
): string {
  const taken = new Set(existingNames);
  let n = 1;
  while (taken.has(format(n))) {
    n += 1;
  }
  return format(n);
}

/** 首页装载入口：读索引，板上文档按需（编辑器打开时）再读。 */
export function readCanvasIndex(workspaceKey: string): CanvasIndex {
  const raw = readSafeLocalStorage(buildCanvasIndexStorageKey(workspaceKey));
  if (!raw) {
    const migrated = migrateLegacyBoard(workspaceKey);
    // 迁移产生的索引立即落盘：让 E2E/后续读取看到一致状态（store 只放内存态）。
    if (migrated.boards.length > 0) {
      writeCanvasIndex(workspaceKey, migrated);
    }
    return migrated;
  }
  try {
    return parseCanvasIndex(JSON.parse(raw) as unknown);
  } catch {
    return { boards: [], lastOpenedBoardId: null };
  }
}

export function writeCanvasIndex(workspaceKey: string, index: CanvasIndex): void {
  writeSafeLocalStorage(buildCanvasIndexStorageKey(workspaceKey), JSON.stringify(index));
}

export function readCanvasBoardDocument(
  workspaceKey: string,
  boardId: string,
): CanvasBoardDocument | null {
  const raw = readSafeLocalStorage(buildCanvasDocStorageKey(workspaceKey, boardId));
  if (!raw) {
    return null;
  }
  try {
    return parseCanvasBoardDocument(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeCanvasBoardDocument(
  workspaceKey: string,
  document: CanvasBoardDocument,
): void {
  writeSafeLocalStorage(buildCanvasDocStorageKey(workspaceKey, document.id), JSON.stringify(document));
}

export function removeCanvasBoardDocument(workspaceKey: string, boardId: string): void {
  removeSafeLocalStorage(buildCanvasDocStorageKey(workspaceKey, boardId));
}

/** 旧版单文档（隐式"每 workspace 一块画布"）迁移为命名画布；只跑一次，成功后移除旧 key。 */
function migrateLegacyBoard(workspaceKey: string): CanvasIndex {
  const legacyRaw = readSafeLocalStorage(buildCanvasLegacyBoardStorageKey(workspaceKey));
  if (!legacyRaw) {
    return { boards: [], lastOpenedBoardId: null };
  }

  let legacy: CanvasBoardDocument | null = null;
  try {
    legacy = parseCanvasBoardDocument(JSON.parse(legacyRaw) as unknown);
  } catch {
    legacy = null;
  }

  removeSafeLocalStorage(buildCanvasLegacyBoardStorageKey(workspaceKey));
  if (!legacy || (legacy.nodes.length === 0 && legacy.edges.length === 0)) {
    return { boards: [], lastOpenedBoardId: null };
  }

  const meta: CanvasBoardMeta = {
    id: createCanvasBoardId(),
    name: clampCanvasBoardName("Canvas"),
    createdAt: legacy.createdAt || Date.now(),
    updatedAt: legacy.updatedAt || Date.now(),
  };
  const document: CanvasBoardDocument = { ...legacy, ...meta };
  writeCanvasBoardDocument(workspaceKey, document);
  return {
    boards: [meta],
    lastOpenedBoardId: meta.id,
  };
}

/** 索引装载的唯一入口：容忍任意脏输入，产出合法索引。 */
export function parseCanvasIndex(value: unknown): CanvasIndex {
  if (typeof value !== "object" || value === null) {
    return { boards: [], lastOpenedBoardId: null };
  }

  const raw = value as Partial<CanvasIndex>;
  const boards: CanvasBoardMeta[] = [];
  const seenIds = new Set<string>();
  const rawBoards = Array.isArray(raw.boards) ? raw.boards : [];
  for (const item of rawBoards) {
    if (boards.length >= CANVAS_BOARD_LIMIT) {
      break;
    }
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const candidate = item as Partial<CanvasBoardMeta>;
    if (
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      typeof candidate.name !== "string" ||
      seenIds.has(candidate.id)
    ) {
      continue;
    }
    seenIds.add(candidate.id);
    boards.push({
      id: candidate.id,
      name: clampCanvasBoardName(candidate.name),
      createdAt:
        typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt)
          ? candidate.createdAt
          : 0,
      updatedAt:
        typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
          ? candidate.updatedAt
          : 0,
    });
  }

  const lastOpened =
    typeof raw.lastOpenedBoardId === "string" && seenIds.has(raw.lastOpenedBoardId)
      ? raw.lastOpenedBoardId
      : null;
  // 倒序规约：首页活墙按最近更新排列，写路径保持同一约定。
  boards.sort((a, b) => b.updatedAt - a.updatedAt);
  return { boards, lastOpenedBoardId: lastOpened };
}

/** 编辑器装载的唯一入口：容忍任意脏输入，id/name 缺失用 meta 回填。 */
export function parseCanvasBoardDocument(
  value: unknown,
  fallbackMeta?: Pick<CanvasBoardMeta, "id" | "name">,
): CanvasBoardDocument {
  const base = createEmptyCanvasBoardDocument(
    fallbackMeta ? { id: fallbackMeta.id, name: fallbackMeta.name } : undefined,
  );
  if (typeof value !== "object" || value === null) {
    return base;
  }

  const raw = value as Partial<CanvasBoardDocument>;
  const nodes = parseNodes(raw.nodes);
  const edges = parseEdges(raw.edges, nodes);
  return {
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : base.id,
    name: typeof raw.name === "string" ? clampCanvasBoardName(raw.name) : base.name,
    createdAt:
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : base.createdAt,
    updatedAt:
      typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : base.updatedAt,
    nodes,
    edges,
    viewport: parseViewport(raw.viewport),
  };
}

function parseNodes(value: unknown): CanvasNode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const nodes: CanvasNode[] = [];
  const seenIds = new Set<string>();
  for (const raw of value) {
    if (nodes.length >= CANVAS_NODE_LIMIT) {
      break;
    }
    const node = parseNode(raw);
    if (!node || seenIds.has(node.id)) {
      continue;
    }
    seenIds.add(node.id);
    nodes.push(node);
  }
  return nodes;
}

function parseNode(value: unknown): CanvasNode | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as Partial<CanvasNode>;
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    return null;
  }

  const position = raw.position;
  if (
    typeof position !== "object" ||
    position === null ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    return null;
  }

  const text = typeof raw.data?.text === "string" ? raw.data.text : "";
  return {
    id: raw.id,
    type: "note",
    // 未知类型（未来版本写入）回退为便签，避免升级丢内容。
    position: { x: position.x, y: position.y },
    data: { text: clampCanvasNoteText(text) },
  };
}

function parseEdges(value: unknown, nodes: readonly CanvasNode[]): CanvasEdge[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: CanvasEdge[] = [];
  const seenIds = new Set<string>();
  for (const raw of value) {
    if (edges.length >= CANVAS_EDGE_LIMIT) {
      break;
    }
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const candidate = raw as Partial<CanvasEdge>;
    const { id, source, target } = candidate;
    if (typeof id !== "string" || id.length === 0 || seenIds.has(id)) {
      continue;
    }
    if (typeof source !== "string" || typeof target !== "string") {
      continue;
    }
    // 孤儿边（指向已删除节点）必须剔除，否则 React Flow 连线渲染异常。
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      continue;
    }
    seenIds.add(id);
    edges.push({ id, source, target });
  }
  return edges;
}

function parseViewport(value: unknown): CanvasViewport {
  if (typeof value !== "object" || value === null) {
    return { ...CANVAS_DEFAULT_VIEWPORT };
  }

  const raw = value as Partial<CanvasViewport>;
  const zoom =
    typeof raw.zoom === "number" && Number.isFinite(raw.zoom)
      ? Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, raw.zoom))
      : CANVAS_DEFAULT_VIEWPORT.zoom;
  return {
    x: typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : CANVAS_DEFAULT_VIEWPORT.x,
    y: typeof raw.y === "number" && Number.isFinite(raw.y) ? raw.y : CANVAS_DEFAULT_VIEWPORT.y,
    zoom,
  };
}
