import { Check, ChevronDown, ChevronsUpDown, MessageCircle, Plus, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { cn } from "@/components/lib/utils.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import shucodeLogoUrl from "@/assets/shucode-logo.png";
import type { CanvasBoardMeta } from "@/lib/canvasBoard.js";
import {
  TID_CANVAS_ADD_NOTE,
  TID_CANVAS_BACK,
  TID_CANVAS_EXIT_CHAT,
  TID_CANVAS_MENU,
  TID_CANVAS_MENU_DELETE,
  TID_CANVAS_MENU_NEW,
  TID_CANVAS_RESET_VIEW,
  TID_CANVAS_SWITCH,
  TID_CANVAS_SWITCH_ITEM,
  TID_CANVAS_SWITCH_NEW,
  testId,
} from "@shucode/shared";

interface CanvasBoardChromeProps {
  boards: readonly CanvasBoardMeta[] | null;
  boardId: string;
  boardName: string;
  projectName?: string;
  boardLimitReached: boolean;
  onBack: () => void;
  onOpenBoard: (boardId: string) => void;
  onCreateBoard: () => void;
  onDeleteBoard: () => void;
  onAddNote: () => void;
  onResetView: () => void;
  /** 退出画布域回到聊天；缺省（无宿主能力，如 E2E fixture）时隐藏该菜单项。 */
  onExitCanvas?: () => void;
}

/**
 * 详情页顶部工具条的两个交互簇（编辑器只负责摆放行容器）：
 * 左簇为红底吉祥物 Logo 菜单（回到首页/新建/删除）+ 项目名 + 画布切换下拉；
 * 右簇为视图操作。桌面端行整体 [app-region:drag]（透明可拖拽窗口），
 * 簇容器单独 no-drag + pointer-events-auto 保证按钮可点（同 DesktopTopOverlay 的命中约定）。
 */
export function CanvasBoardChrome({
  boards,
  boardId,
  boardName,
  projectName,
  boardLimitReached,
  onBack,
  onOpenBoard,
  onCreateBoard,
  onDeleteBoard,
  onAddNote,
  onResetView,
  onExitCanvas,
}: CanvasBoardChromeProps) {
  const { intl } = useShucodeIntl();
  const boardLimitTitle = boardLimitReached
    ? intl.formatMessage({ id: "canvasHome.boardLimit" })
    : undefined;

  return (
    <>
      <div className="pointer-events-auto flex items-center gap-1 [app-region:no-drag]">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-md"
              data-testid={TID_CANVAS_MENU}
              aria-label={intl.formatMessage({ id: "canvas.title" })}
            >
              <img src={shucodeLogoUrl} alt="" className="size-6" draggable={false} />
              <ChevronsUpDown className="size-3 text-foreground-subtlest" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44 [app-region:no-drag]">
            <DropdownMenuItem data-testid={TID_CANVAS_BACK} onSelect={onBack}>
              <Undo2 className="size-4" />
              {intl.formatMessage({ id: "canvas.menuHome" })}
            </DropdownMenuItem>
            {onExitCanvas ? (
              <DropdownMenuItem data-testid={TID_CANVAS_EXIT_CHAT} onSelect={onExitCanvas}>
                <MessageCircle className="size-4" />
                {intl.formatMessage({ id: "canvas.exitToChat" })}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              data-testid={TID_CANVAS_MENU_NEW}
              disabled={boardLimitReached}
              title={boardLimitTitle}
              onSelect={onCreateBoard}
            >
              <Plus className="size-4" />
              {intl.formatMessage({ id: "canvas.menuNew" })}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              data-testid={TID_CANVAS_MENU_DELETE}
              onSelect={onDeleteBoard}
            >
              <Trash2 className="size-4" />
              {intl.formatMessage({ id: "canvasHome.remove" })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {projectName ? (
          <>
            <span className="min-w-0 max-w-44 truncate text-ui-sm text-foreground-subtle">
              {projectName}
            </span>
            <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
          </>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-testid={TID_CANVAS_SWITCH}
              className="min-w-0 font-normal text-foreground-subtle"
            >
              <span className="min-w-0 truncate">{boardName}</span>
              <ChevronDown className="size-3.5 shrink-0 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44 [app-region:no-drag]">
            {(boards ?? []).map((boardItem) => (
              <DropdownMenuItem
                key={boardItem.id}
                data-testid={testId(TID_CANVAS_SWITCH_ITEM, boardItem.id)}
                onSelect={() => onOpenBoard(boardItem.id)}
              >
                <Check
                  className={cn(
                    "size-4 shrink-0",
                    boardItem.id === boardId ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="min-w-0 truncate">{boardItem.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid={TID_CANVAS_SWITCH_NEW}
              disabled={boardLimitReached}
              title={boardLimitTitle}
              onSelect={onCreateBoard}
            >
              <Plus className="size-4" />
              {intl.formatMessage({ id: "canvas.menuNew" })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="pointer-events-auto ml-auto flex items-center gap-2 [app-region:no-drag]">
        <Button variant="ghost" size="sm" data-testid={TID_CANVAS_RESET_VIEW} onClick={onResetView}>
          {intl.formatMessage({ id: "canvas.resetView" })}
        </Button>
        <Button variant="outline" size="sm" data-testid={TID_CANVAS_ADD_NOTE} onClick={onAddNote}>
          <Plus className="size-3.5" />
          {intl.formatMessage({ id: "canvas.addNote" })}
        </Button>
      </div>
    </>
  );
}
