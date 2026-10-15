import { useCallback, useMemo, type CSSProperties } from "react";
import { Plus } from "lucide-react";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import {
  buildCanvasBoardWorkspaceKey,
  CANVAS_BOARD_LIMIT,
  pickDefaultBoardName,
  type CanvasBoardMeta,
} from "@/lib/canvasBoard.js";
import {
  TID_CANVAS_HOME,
  TID_CANVAS_HOME_NEW,
  TID_CANVAS_HOME_WALL,
  TID_CANVAS_HOME_WALL_ITEM,
  TID_CANVAS_HOME_WALL_REMOVE,
  testId,
} from "@shucode/shared";
import { useCanvasBoardStore } from "@/store/canvasBoardStore.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";

export interface CanvasHomeProps {
  workspacePath: string;
  workspaceIdentity?: string;
  onOpenBoard: (boardId: string) => void;
  /** 桌面端内容整体下移 48px，让出画布域顶部透明拖拽条（画布背景上探其后的真全屏布局）。 */
  isDesktop?: boolean;
}

/** 活墙占位底：按 boardId 哈希取一组渐变，纯视觉装饰，不代表媒体内容。 */
const WALL_GRADIENTS = [
  "linear-gradient(135deg, #0e7490, #155e75)",
  "linear-gradient(135deg, #4c1d95, #7c3aed)",
  "linear-gradient(135deg, #9d174d, #be185d)",
  "linear-gradient(135deg, #374151, #1f2937)",
  "linear-gradient(135deg, #065f46, #0d9488)",
  "linear-gradient(135deg, #b45309, #d97706)",
  "linear-gradient(135deg, #1e40af, #3b82f6)",
  "linear-gradient(135deg, #134e4a, #059669)",
];

function gradientForBoardId(boardId: string): string {
  let hash = 0;
  for (let index = 0; index < boardId.length; index += 1) {
    hash = (hash * 31 + boardId.charCodeAt(index)) >>> 0;
  }
  return WALL_GRADIENTS[hash % WALL_GRADIENTS.length] ?? WALL_GRADIENTS[0]!;
}

/** 索引未装载（loadWorkspace 异步落定前）的稳定空值，避免 selector 每次渲染产出新引用。 */
const EMPTY_INDEX = { boards: [], lastOpenedBoardId: null };

export function CanvasHome({ workspacePath, workspaceIdentity, onOpenBoard, isDesktop }: CanvasHomeProps) {
  const { intl } = useShucodeIntl();
  const workspaceKey = useMemo(
    () => buildCanvasBoardWorkspaceKey({ workspacePath, workspaceIdentity }),
    [workspacePath, workspaceIdentity],
  );
  const index =
    useCanvasBoardStore((state) => state.workspaces[workspaceKey]?.index) ?? EMPTY_INDEX;
  const createBoard = useCanvasBoardStore((state) => state.createBoard);
  const deleteBoard = useCanvasBoardStore((state) => state.deleteBoard);
  const requestConfirmation = useConfirmDialogStore((state) => state.requestConfirmation);
  const limitReached = index.boards.length >= CANVAS_BOARD_LIMIT;

  const handleCreate = useCallback(() => {
    if (limitReached) {
      return;
    }
    // 默认名取自现有数量并循环避让同名（规则唯一来源在 lib，详情页菜单共用）；名称只做展示。
    const name = pickDefaultBoardName(
      (n) => intl.formatMessage({ id: "canvas.defaultBoardName" }, { n }),
      index.boards.map((board) => board.name),
    );
    const created = createBoard({ workspacePath, workspaceIdentity, name });
    if (created) {
      onOpenBoard(created.id);
    }
  }, [createBoard, index.boards, intl, limitReached, onOpenBoard, workspaceIdentity, workspacePath]);

  const handleRemove = useCallback(
    async (boardId: string, name: string) => {
      const confirmed = await requestConfirmation({
        title: intl.formatMessage({ id: "canvasHome.deleteTitle" }, { name }),
        description: intl.formatMessage({ id: "canvasHome.deleteDesc" }),
        confirmLabel: intl.formatMessage({ id: "canvasHome.deleteConfirm" }),
        confirmVariant: "destructive",
      });
      if (confirmed) {
        deleteBoard({ workspacePath, workspaceIdentity, boardId });
      }
    },
    [deleteBoard, intl, requestConfirmation, workspaceIdentity, workspacePath],
  );

  const stats = useMemo(() => {
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayStart = startOfToday.getTime();
    const counts = Array.from({ length: 7 }, (_, i) => {
      const from = todayStart - (6 - i) * dayMs;
      return index.boards.filter(
        (board) => board.updatedAt >= from && board.updatedAt < from + dayMs,
      ).length;
    });
    return counts;
  }, [index.boards]);
  const maxCount = Math.max(1, ...stats);

  return (
    <div
      data-testid={TID_CANVAS_HOME}
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-background${isDesktop ? " pt-12" : ""}`}
    >
      {/* 与插件市场/自动化一致：内容列居中限宽；整页收进一屏（网格按剩余高度自适应，无页面滚动） */}
      <div className="mx-auto flex w-full min-h-0 max-w-6xl flex-1 flex-col px-4 py-5 md:px-6 md:py-6">
      <div className="mb-4 flex shrink-0 items-baseline gap-3">
        <h1 className="text-ui-xl font-extrabold">{intl.formatMessage({ id: "canvas.title" })}</h1>
        <span className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "canvasHome.subtitle" }, { n: index.boards.length })}
        </span>
        <div className="flex-1" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-4 grid-rows-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-3.5">
        {/* 新建大磁贴 */}
        <button
          type="button"
          data-testid={TID_CANVAS_HOME_NEW}
          onClick={handleCreate}
          aria-disabled={limitReached}
          title={limitReached ? intl.formatMessage({ id: "canvasHome.boardLimit" }) : undefined}
          className="col-span-3 row-span-2 flex flex-col items-center justify-center gap-3 rounded-xl border border-border outline-none transition hover:border-foreground-subtle/40 focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          style={{
            backgroundImage:
              // 双色氛围渐变 + 点阵网格：网格线用中性灰保证浅色/深色主题都成立
              "radial-gradient(100% 130% at 85% 0%, rgba(139,92,246,.18), transparent 50%)," +
              "radial-gradient(120% 100% at 0% 100%, rgba(56,189,248,.14), transparent 55%)," +
              "repeating-linear-gradient(0deg, transparent 0 26px, rgba(127,135,146,.18) 26px 27px)," +
              "repeating-linear-gradient(90deg, transparent 0 26px, rgba(127,135,146,.18) 26px 27px)",
          }}
        >
          <span className="flex size-14 items-center justify-center rounded-2xl bg-foreground text-background shadow-lg">
            <Plus className="size-6" />
          </span>
          <span className="text-ui-lg font-extrabold">
            {intl.formatMessage({ id: "canvasHome.newTitle" })}
          </span>
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "canvasHome.newSub" })}
          </span>
        </button>

        {/* 占位磁贴：生成模型接入后转为真实入口（row-start 等类为静态字面量，供 Tailwind 扫描） */}
        <PlaceholderTile
          className="col-start-4 row-start-1"
          title={intl.formatMessage({ id: "canvasHome.modelMatrix" })}
          desc={intl.formatMessage({ id: "canvasHome.modelMatrixDesc" })}
        />
        <PlaceholderTile
          className="col-start-4 row-start-2"
          title={intl.formatMessage({ id: "canvasHome.templateCenter" })}
          desc={intl.formatMessage({ id: "canvasHome.templateCenterDesc" })}
        />

        {/* 最近的画布（历史记录核心）——此行比例最大，高度随窗口自适应 */}
        <div
          data-testid={TID_CANVAS_HOME_WALL}
          className="col-start-1 col-end-4 row-start-3 flex min-h-0 flex-col rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2.5 pb-3">
            <b className="text-ui-base font-bold">{intl.formatMessage({ id: "canvasHome.wallTitle" })}</b>
          </div>
          {index.boards.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <span className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "canvasHome.wallEmpty" })}
              </span>
            </div>
          ) : index.boards.length === 1 ? (
            <div className="grid min-h-0 flex-1 grid-cols-3 gap-2.5 overflow-hidden">
              {index.boards.map((board) => (
                <BoardTile
                  key={board.id}
                  boardId={board.id}
                  name={board.name}
                  updatedAt={board.updatedAt}
                  onOpen={onOpenBoard}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          ) : (
            <WallMarquee boards={index.boards} onOpen={onOpenBoard} onRemove={handleRemove} />
          )}
        </div>

        {/* 统计（纯本地索引聚合） */}
        <div className="col-start-4 row-start-3 flex flex-col rounded-xl border border-border bg-card p-4">
          <b className="text-ui-sm">{intl.formatMessage({ id: "canvasHome.statsTitle" })}</b>
          <div className="mt-2 text-ui-lg font-extrabold">
            {intl.formatMessage({ id: "canvasHome.statsBoards" }, { n: index.boards.length })}
          </div>
          <div className="mt-1 text-ui-xs text-foreground-subtle">
            {intl.formatMessage({ id: "canvasHome.stats7d" }, { n: stats.reduce((a, b) => a + b, 0) })}
          </div>
          <div className="mt-auto flex h-9 items-end gap-1 pt-2">
            {stats.map((count, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-[3px] bg-foreground-subtle/40"
                style={{ height: `${Math.max(8, (count / maxCount) * 100)}%` }}
              />
            ))}
          </div>
        </div>

        {/* 能力占位磁贴 */}
        <PlaceholderTile
          className="col-span-1 row-start-4"
          title={intl.formatMessage({ id: "canvasHome.taskVideo" })}
          desc={intl.formatMessage({ id: "canvasHome.taskVideoDesc" })}
        />
        <PlaceholderTile
          className="col-span-1 row-start-4"
          title={intl.formatMessage({ id: "canvasHome.taskImage" })}
          desc={intl.formatMessage({ id: "canvasHome.taskImageDesc" })}
        />
        <PlaceholderTile
          className="col-span-1 row-start-4"
          title={intl.formatMessage({ id: "canvasHome.taskAudio" })}
          desc={intl.formatMessage({ id: "canvasHome.taskAudioDesc" })}
        />
        <PlaceholderTile
          className="col-span-1 row-start-4"
          title={intl.formatMessage({ id: "canvasHome.taskEdit" })}
          desc={intl.formatMessage({ id: "canvasHome.taskEditDesc" })}
        />
      </div>
      </div>
    </div>
  );
}

function PlaceholderTile({ className, title, desc }: { className: string; title: string; desc: string }) {
  const { intl } = useShucodeIntl();
  return (
    <div
      aria-disabled="true"
      className={`relative flex flex-col justify-between rounded-xl border border-border bg-card/60 p-4 opacity-60 ${className}`}
    >
      <em className="absolute right-3 top-3 not-italic text-ui-xs text-foreground-subtle">
        {intl.formatMessage({ id: "canvasHome.comingSoon" })}
      </em>
      <div>
        <div className="text-ui-base font-bold">{title}</div>
        <div className="mt-1 text-ui-xs text-foreground-subtle">{desc}</div>
      </div>
    </div>
  );
}

/**
 * 活墙无限滚动：每排渲染整数份序列，CSS 位移 -50% 后无缝回环。
 * 只动 translate（合成线程，不触发布局/重排）；容器 hover/focus-within 暂停；
 * prefers-reduced-motion 下由全局样式静止。
 */
function WallMarquee({
  boards,
  onOpen,
  onRemove,
}: {
  boards: CanvasBoardMeta[];
  onOpen: (boardId: string) => void;
  onRemove: (boardId: string, name: string) => void;
}) {
  const lanes = [0, 1].map((lane) => {
    const sequence = lane === 0 ? boards : [...boards].reverse();
    // 复制整数份保证 -50% 无缝；序列总宽度按板数自适应复制次数。
    const reps = Math.max(2, Math.ceil(8 / sequence.length));
    return {
      className: lane === 0 ? "canvas-marquee-lane-forward" : "canvas-marquee-lane-backward",
      boards: Array.from({ length: reps }, () => sequence).flat(),
    };
  });
  return (
    <div className="canvas-marquee min-h-0 flex-1 overflow-hidden pt-1">
      <div className="flex h-full flex-col gap-2.5">
        {lanes.map((lane, laneIndex) => (
          <div
            key={laneIndex}
            className={`canvas-marquee-lane flex min-h-0 flex-1 gap-2.5 ${lane.className}`}
            style={
              {
                "--canvas-marquee-duration": boards.length > 6 ? "64s" : "38s",
              } as CSSProperties
            }
          >
            {lane.boards.map((board, index) => (
              <BoardTile
                key={`${board.id}-${index}`}
                boardId={board.id}
                name={board.name}
                updatedAt={board.updatedAt}
                onOpen={onOpen}
                onRemove={onRemove}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function BoardTile({
  boardId,
  name,
  updatedAt,
  onOpen,
  onRemove,
}: {
  boardId: string;
  name: string;
  updatedAt: number;
  onOpen: (boardId: string) => void;
  onRemove: (boardId: string, name: string) => void;
}) {
  const { intl, localePreference } = useShucodeIntl();
  return (
    <div
      data-testid={testId(TID_CANVAS_HOME_WALL_ITEM, boardId)}
      className="group/wall relative flex h-full w-40 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <button
        type="button"
        onClick={() => onOpen(boardId)}
        className="flex h-full w-full flex-col text-left outline-none transition hover:brightness-110"
      >
        <div
          className="min-h-0 flex-1 items-end rounded-t-lg p-2"
          style={{ backgroundImage: gradientForBoardId(boardId) }}
        />
        <div className="flex min-w-0 shrink-0 items-center gap-1.5 px-2 py-1.5">
          <span className="min-w-0 truncate text-ui-xs font-semibold text-foreground">{name}</span>
          <span className="ml-auto shrink-0 text-ui-xs text-foreground-subtle">
            {formatBoardTime(updatedAt, localePreference === "en-US" ? "en-US" : "zh-CN")}
          </span>
        </div>
      </button>
      <button
        type="button"
        aria-label={intl.formatMessage({ id: "canvasHome.remove" })}
        data-testid={testId(TID_CANVAS_HOME_WALL_REMOVE, boardId)}
        onClick={(event) => {
          event.stopPropagation();
          void onRemove(boardId, name);
        }}
        className="absolute right-1.5 top-1.5 hidden size-5 items-center justify-center rounded-md bg-background/90 text-ui-xs text-foreground-subtle hover:text-foreground group-hover/wall:flex"
      >
        ✕
      </button>
    </div>
  );
}

function formatBoardTime(timestamp: number, locale: string): string {
  if (!timestamp) {
    return "—";
  }
  const diffMs = Date.now() - timestamp;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diffMs < 60 * 60 * 1000) {
    return rtf.format(-Math.round(diffMs / (60 * 1000)), "minute");
  }
  if (diffMs < 24 * 60 * 60 * 1000) {
    return rtf.format(-Math.round(diffMs / (60 * 60 * 1000)), "hour");
  }
  return rtf.format(-Math.round(diffMs / (24 * 60 * 60 * 1000)), "day");
}
