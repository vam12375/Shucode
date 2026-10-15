/* eslint-disable max-lines -- 详情页编排器：受控 React Flow 的变更/连线/视口回调与
   工具条回调集中收口，强行拆散会切断 openBoard/持久化到节点的单一数据流；与 WorkspaceShellLayout 同款豁免。 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import { PanelLeft } from "lucide-react";
import { Canvas } from "@/components/ai-elements/canvas.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import {
  buildCanvasBoardWorkspaceKey,
  CANVAS_BOARD_LIMIT,
  pickDefaultBoardName,
} from "@/lib/canvasBoard.js";
import {
  TID_CANVAS_BOARD,
  TID_CANVAS_PANEL_OPEN,
  TID_CANVAS_ZOOM,
} from "@shucode/shared";
import { useCanvasBoardStore } from "@/store/canvasBoardStore.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
import { CanvasBoardScopeContext } from "@/canvas/canvasBoardScopeContext.js";
import { CANVAS_NODE_TYPES } from "@/canvas/CanvasNoteNode.js";
import {
  CanvasBoardEmptyState,
  CanvasBoardSidePanel,
  type CanvasPanelTab,
} from "@/canvas/CanvasBoardSidePanel.js";
import { CanvasBoardChrome } from "@/canvas/CanvasBoardChrome.js";

/** 节点固定宽度；双击/居中创建时的偏移按它估算，让节点视觉中心落在触发点。 */
const NOTE_NODE_WIDTH = 320;
const NOTE_NODE_HINT_HEIGHT = 120;

export interface CanvasBoardProps {
  workspacePath: string;
  workspaceIdentity?: string;
  boardId: string;
  /** 仅用于工具条展示的项目名；为空时隐藏该段。 */
  projectName?: string;
  /** 桌面端把工具条并入壳层顶部拖拽条（真全屏）；Web 端为常规顶部工具行。 */
  isDesktop?: boolean;
  /** 桌面端并入拖拽条后左侧避让（px）：macOS 红绿灯 + 顶部浮层按钮簇（侧栏收起时）。 */
  chromeLeftInsetPx?: number;
  /** 桌面端右侧避让（px）：Windows/Linux 右上自绘窗控（- □ ×）。 */
  chromeRightInsetPx?: number;
  onBack: () => void;
  /** 画布切换下拉/菜单内新建画布后切换到对应 boardId。 */
  onOpenBoard: (boardId: string) => void;
  /** 退出画布域回到聊天（Logo 菜单「返回聊天」）；缺省时隐藏该项（如 E2E fixture）。 */
  onExitCanvas?: () => void;
}

export function CanvasBoard(props: CanvasBoardProps) {
  // scope 必须含 boardId：节点组件经 context 提交文本/删除时依赖它定位所在画布。
  const scope = useMemo(
    () => ({
      workspacePath: props.workspacePath,
      workspaceIdentity: props.workspaceIdentity,
      boardId: props.boardId,
    }),
    [props.workspacePath, props.workspaceIdentity, props.boardId],
  );
  return (
    <ReactFlowProvider>
      <CanvasBoardScopeContext.Provider value={scope}>
        <CanvasBoardInner {...props} />
      </CanvasBoardScopeContext.Provider>
    </ReactFlowProvider>
  );
}

function CanvasBoardInner({
  workspacePath,
  workspaceIdentity,
  boardId,
  projectName,
  isDesktop,
  chromeLeftInsetPx,
  chromeRightInsetPx,
  onBack,
  onOpenBoard,
  onExitCanvas,
}: CanvasBoardProps) {
  const { intl } = useShucodeIntl();
  const scope = useMemo(
    () => ({ workspacePath, workspaceIdentity, boardId }),
    [workspacePath, workspaceIdentity, boardId],
  );
  const workspaceKey = useMemo(() => buildCanvasBoardWorkspaceKey(scope), [scope]);
  const boardMeta = useCanvasBoardStore((state) => {
    const workspace = state.workspaces[workspaceKey];
    return workspace?.index.boards.find((board) => board.id === boardId);
  });
  const boards = useCanvasBoardStore(
    (state) => state.workspaces[workspaceKey]?.index.boards ?? null,
  );
  const board = useCanvasBoardStore(
    (state) => state.workspaces[workspaceKey]?.docs[boardId],
  );
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<ReadonlySet<string>>(() => new Set());
  // 左侧节点/资产面板：默认展开（参考 libtv），收起态经画布左下角「资产管理」重开。
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<CanvasPanelTab>("nodes");
  const [zoomPercent, setZoomPercent] = useState(100);
  // 受控 flow 必须把 xyflow 测得的节点尺寸回传，否则节点不被初始化（#015），
  // 连线与拖拽全部失效。尺寸只进渲染态，不入持久化文档。
  const [nodeMeasured, setNodeMeasured] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const { screenToFlowPosition, fitView, setCenter } = useReactFlow();

  const openBoard = useCanvasBoardStore((state) => state.openBoard);
  const createBoard = useCanvasBoardStore((state) => state.createBoard);
  const deleteBoard = useCanvasBoardStore((state) => state.deleteBoard);
  const addNote = useCanvasBoardStore((state) => state.addNote);
  const moveNode = useCanvasBoardStore((state) => state.moveNode);
  const removeNodes = useCanvasBoardStore((state) => state.removeNodes);
  const addConnection = useCanvasBoardStore((state) => state.addConnection);
  const removeEdges = useCanvasBoardStore((state) => state.removeEdges);
  const setViewport = useCanvasBoardStore((state) => state.setViewport);
  const persistBoard = useCanvasBoardStore((state) => state.persistBoard);
  const requestConfirmation = useConfirmDialogStore((state) => state.requestConfirmation);

  useEffect(() => {
    openBoard(scope);
  }, [openBoard, scope]);

  // 切换画布时重置随板变化的本地渲染态；viewport 由 Canvas 重挂载
  // （下方 key={boardId}）后经 defaultViewport 恢复。
  useEffect(() => {
    setNodeMeasured({});
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
  }, [boardId]);

  const boardZoom = board?.viewport.zoom;
  useEffect(() => {
    if (typeof boardZoom === "number") {
      setZoomPercent(Math.round(boardZoom * 100));
    }
  }, [boardZoom]);

  const boardLimitReached = (boards?.length ?? 0) >= CANVAS_BOARD_LIMIT;

  const handleCreateBoard = useCallback(() => {
    if (boardLimitReached) {
      return;
    }
    // 与首页磁贴共用同一条默认命名规则，保证「画布 N」不重名。
    const name = pickDefaultBoardName(
      (n) => intl.formatMessage({ id: "canvas.defaultBoardName" }, { n }),
      (boards ?? []).map((boardItem) => boardItem.name),
    );
    const created = createBoard({ workspacePath, workspaceIdentity, name });
    if (created) {
      onOpenBoard(created.id);
    }
  }, [boardLimitReached, boards, createBoard, intl, onOpenBoard, workspaceIdentity, workspacePath]);

  const handleDeleteBoard = useCallback(async () => {
    if (!boardMeta) {
      return;
    }
    const confirmed = await requestConfirmation({
      title: intl.formatMessage({ id: "canvasHome.deleteTitle" }, { name: boardMeta.name }),
      description: intl.formatMessage({ id: "canvasHome.deleteDesc" }),
      confirmLabel: intl.formatMessage({ id: "canvasHome.deleteConfirm" }),
      confirmVariant: "destructive",
    });
    if (!confirmed) {
      return;
    }
    deleteBoard({ workspacePath, workspaceIdentity, boardId });
    onBack();
  }, [
    boardId,
    boardMeta,
    deleteBoard,
    intl,
    onBack,
    requestConfirmation,
    workspaceIdentity,
    workspacePath,
  ]);

  const rfNodes = useMemo(
    () =>
      board?.nodes.map((node) => ({
        ...node,
        selected: selectedNodeIds.has(node.id),
        measured: nodeMeasured[node.id],
      })) ?? [],
    [board, nodeMeasured, selectedNodeIds],
  );
  const rfEdges = useMemo(
    () =>
      board?.edges.map((edge) => ({ ...edge, selected: selectedEdgeIds.has(edge.id) })) ?? [],
    [board, selectedEdgeIds],
  );

  // ai-elements Canvas 固定 ReactFlowProps<Node, Edge> 泛型，回调参数按默认 Node/Edge 接，
  // 内部只用 id/position/selected 等基础字段，不触碰 data 形状。
  const applyNodeChanges = useCallback(
    (changes: NodeChange[]) => {
      let nextSelected: Set<string> | null = null;
      const removedIds: string[] = [];
      for (const change of changes) {
        if (change.type === "select") {
          nextSelected ??= new Set(selectedNodeIds);
          if (change.selected) {
            nextSelected.add(change.id);
          } else {
            nextSelected.delete(change.id);
          }
        } else if (change.type === "remove") {
          removedIds.push(change.id);
        } else if (change.type === "position" && change.position) {
          // 拖动中的受控位置同步只进内存态；落盘统一在 onNodeDragStop。
          moveNode({
            workspacePath,
            workspaceIdentity,
            boardId,
            nodeId: change.id,
            position: change.position,
          });
        } else if (change.type === "dimensions" && change.dimensions) {
          const dimensions = change.dimensions;
          setNodeMeasured((prev) => {
            const current = prev[change.id];
            if (current?.width === dimensions.width && current?.height === dimensions.height) {
              return prev;
            }
            return { ...prev, [change.id]: dimensions };
          });
        }
      }
      if (nextSelected) {
        for (const id of removedIds) {
          nextSelected.delete(id);
        }
        setSelectedNodeIds(nextSelected);
      }
      if (removedIds.length > 0) {
        removeNodes({ workspacePath, workspaceIdentity, boardId, nodeIds: removedIds });
      }
    },
    [boardId, moveNode, removeNodes, selectedNodeIds, workspaceIdentity, workspacePath],
  );

  const applyEdgeChanges = useCallback(
    (changes: EdgeChange[]) => {
      const removedIds: string[] = [];
      let nextSelected: Set<string> | null = null;
      for (const change of changes) {
        if (change.type === "remove") {
          removedIds.push(change.id);
        } else if (change.type === "select") {
          nextSelected ??= new Set(selectedEdgeIds);
          if (change.selected) {
            nextSelected.add(change.id);
          } else {
            nextSelected.delete(change.id);
          }
        }
      }
      if (nextSelected) {
        setSelectedEdgeIds(nextSelected);
      }
      if (removedIds.length > 0) {
        removeEdges({ workspacePath, workspaceIdentity, boardId, edgeIds: removedIds });
      }
    },
    [boardId, removeEdges, selectedEdgeIds, workspaceIdentity, workspacePath],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }
      addConnection({
        workspacePath,
        workspaceIdentity,
        boardId,
        source: connection.source,
        target: connection.target,
      });
    },
    [addConnection, boardId, workspaceIdentity, workspacePath],
  );

  const handleNodeDragStop = useCallback(() => {
    persistBoard({ workspacePath, workspaceIdentity, boardId });
  }, [boardId, persistBoard, workspaceIdentity, workspacePath]);

  // onMove 高频回调只更新本地缩放百分比（四舍五入自然去抖）；落盘仍走 onMoveEnd。
  const handleMove = useCallback((_event: unknown, viewport: Viewport) => {
    const nextPercent = Math.round(viewport.zoom * 100);
    setZoomPercent((prev) => (prev === nextPercent ? prev : nextPercent));
  }, []);

  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      setViewport({
        workspacePath,
        workspaceIdentity,
        boardId,
        viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
      });
    },
    [boardId, setViewport, workspaceIdentity, workspacePath],
  );

  const handleAddNote = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const center = screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    addNote({
      workspacePath,
      workspaceIdentity,
      boardId,
      position: { x: center.x - NOTE_NODE_WIDTH / 2, y: center.y - NOTE_NODE_HINT_HEIGHT / 2 },
    });
  }, [addNote, boardId, screenToFlowPosition, workspaceIdentity, workspacePath]);

  const handleResetView = useCallback(() => {
    void fitView({ padding: 0.25, duration: 200 });
  }, [fitView]);

  /** 面板节点条目点击：把该节点居中聚焦（尺寸未知时按便签基准估算视觉中心）。 */
  const focusNode = useCallback(
    (nodeId: string) => {
      const node = board?.nodes.find((item) => item.id === nodeId);
      if (!node) {
        return;
      }
      void setCenter(
        node.position.x + NOTE_NODE_WIDTH / 2,
        node.position.y + NOTE_NODE_HINT_HEIGHT / 2,
        { zoom: Math.max(zoomPercent / 100, 1), duration: 300 },
      );
    },
    [board, setCenter, zoomPercent],
  );

  // 双击空白 pane 创建节点；双击节点/连线（编辑、缩放冲突）不触发。
  const handleCanvasDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      if (!event.target.closest(".react-flow__pane")) {
        return;
      }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNote({
        workspacePath,
        workspaceIdentity,
        boardId,
        position: {
          x: position.x - NOTE_NODE_WIDTH / 2,
          y: position.y - NOTE_NODE_HINT_HEIGHT / 2,
        },
      });
    },
    [addNote, boardId, screenToFlowPosition, workspaceIdentity, workspacePath],
  );

  // 装载完成前不挂载 React Flow：defaultViewport 只在首次挂载生效，
  // 提前挂载会丢失上次保存的视口位置。判断必须放在全部 hooks 之后，保证 hooks 顺序稳定。
  if (!board) {
    return null;
  }

  const nodeCount = board.nodes.length;
  const boardName = boardMeta?.name ?? intl.formatMessage({ id: "canvas.title" });

  return (
    // 详情页参考 libtv：铺满画布域、无圆角外框。桌面端画布点阵背景铺满整高（上探到 48px
    // 透明拖拽条后，真全屏），仅左侧面板从条下开始避开窗控安全区；Web 端工具条为常规顶栏。
    <div
      data-testid={TID_CANVAS_BOARD}
      className="relative flex h-full min-h-0 flex-col bg-sidebar"
    >
      {isDesktop ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-20 [app-region:drag]"
          style={{
            paddingLeft: chromeLeftInsetPx ? chromeLeftInsetPx + 12 : 12,
            paddingRight: chromeRightInsetPx ? chromeRightInsetPx + 12 : 12,
          }}
        >
          <div className="flex h-12 items-center gap-1 pt-2">
            <CanvasBoardChrome
              boards={boards}
              boardId={boardId}
              boardName={boardName}
              projectName={projectName}
              boardLimitReached={boardLimitReached}
              onBack={onBack}
              onOpenBoard={onOpenBoard}
              onCreateBoard={handleCreateBoard}
              onDeleteBoard={() => void handleDeleteBoard()}
              onAddNote={handleAddNote}
              onResetView={handleResetView}
              onExitCanvas={onExitCanvas}
            />
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex h-12 shrink-0 items-center gap-1 px-3">
          <CanvasBoardChrome
            boards={boards}
            boardId={boardId}
            boardName={boardName}
            projectName={projectName}
            boardLimitReached={boardLimitReached}
            onBack={onBack}
            onOpenBoard={onOpenBoard}
            onCreateBoard={handleCreateBoard}
            onDeleteBoard={() => void handleDeleteBoard()}
            onAddNote={handleAddNote}
            onResetView={handleResetView}
            onExitCanvas={onExitCanvas}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {panelOpen ? (
          <CanvasBoardSidePanel
            nodes={board.nodes}
            tab={panelTab}
            onTabChange={setPanelTab}
            onFocusNode={focusNode}
            onCollapse={() => setPanelOpen(false)}
            offsetTopStrip={isDesktop}
          />
        ) : null}

        <div
          ref={wrapperRef}
          className="relative min-h-0 min-w-0 flex-1"
          onDoubleClick={handleCanvasDoubleClick}
        >
          <Canvas
            key={boardId}
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={CANVAS_NODE_TYPES}
            onNodesChange={applyNodeChanges}
            onEdgesChange={applyEdgeChanges}
            onConnect={handleConnect}
            onNodeDragStop={handleNodeDragStop}
            onMove={handleMove}
            onMoveEnd={handleMoveEnd}
            defaultViewport={board.viewport}
            fitView={false}
            minZoom={0.1}
            maxZoom={4}
            // 详情页用左下角百分比 + 滚轮/触控板缩放，不展示 xyflow 控件与归因标（参考 libtv）。
            proOptions={{ hideAttribution: true }}
          />

          {/* 左下角：面板收起时的「资产管理」重开按钮 + 常驻缩放百分比（面板展开时位于画布区左下） */}
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
            {panelOpen ? null : (
              <button
                type="button"
                data-testid={TID_CANVAS_PANEL_OPEN}
                onClick={() => {
                  setPanelOpen(true);
                  setPanelTab("nodes");
                }}
                className="flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-ui-sm text-foreground outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PanelLeft className="size-4 text-foreground-subtle" />
                {intl.formatMessage({ id: "canvas.panelAssetsOpen" })}
              </button>
            )}
            <span
              className="flex h-8 items-center rounded-lg border border-border bg-card px-2.5 text-ui-sm tabular-nums text-foreground-subtle"
              data-testid={TID_CANVAS_ZOOM}
            >
              {zoomPercent}%
            </span>
          </div>

          {nodeCount === 0 ? <CanvasBoardEmptyState /> : null}
        </div>
      </div>
    </div>
  );
}
