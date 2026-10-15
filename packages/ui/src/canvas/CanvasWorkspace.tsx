import { useEffect, useState } from "react";
import { CanvasHome } from "@/canvas/CanvasHome.js";
import { CanvasBoard } from "@/CanvasBoard.js";
import { useCanvasBoardStore } from "@/store/canvasBoardStore.js";

export interface CanvasWorkspaceProps {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 详情页工具条展示的项目名（壳层透传，仅展示用）。 */
  projectName?: string;
  /** 桌面端把工具条并入顶部拖拽条（真全屏），并自绘 48px 透明拖拽条。 */
  isDesktop?: boolean;
  /** 桌面端拖拽条内左侧避让（px）：macOS 红绿灯（侧栏收起时）。 */
  chromeLeftInsetPx?: number;
  /** 桌面端拖拽条内右侧避让（px）：Windows/Linux 自绘窗控。 */
  chromeRightInsetPx?: number;
  /** 编辑器打开/关闭时通知壳层：用于隐藏顶部浮层按钮簇并联动侧栏收起/恢复。 */
  onEditorOpenChange?: (open: boolean) => void;
  /** 退出画布域回到聊天（详情页 Logo 菜单「返回聊天」）；首页经顶部浮层返回，无需该项。 */
  onExitCanvas?: () => void;
}

/**
 * 画布域根组件：点击侧边栏「画布」后的容器。
 * 首页 ⇄ 编辑器的切换只在本组件的本地 state 内流转；workspaceMainView 离开
 * 画布域时本组件随 Shell 卸载，回到画布域默认显示首页（内容已持久化不丢）。
 */
export function CanvasWorkspace({
  workspacePath,
  workspaceIdentity,
  projectName,
  isDesktop,
  chromeLeftInsetPx,
  chromeRightInsetPx,
  onEditorOpenChange,
  onExitCanvas,
}: CanvasWorkspaceProps) {
  const [openBoardId, setOpenBoardId] = useState<string | null>(null);
  const loadWorkspace = useCanvasBoardStore((state) => state.loadWorkspace);

  useEffect(() => {
    // 装载索引（含旧版单文档迁移）；workspaceKey 变化时回首页并由 loadWorkspace 重读对应域。
    setOpenBoardId(null);
  }, [workspacePath, workspaceIdentity]);

  useEffect(() => {
    loadWorkspace({ workspacePath, workspaceIdentity });
  }, [loadWorkspace, workspacePath, workspaceIdentity]);

  useEffect(() => {
    onEditorOpenChange?.(openBoardId !== null);
  }, [onEditorOpenChange, openBoardId]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {isDesktop ? (
        // 画布域顶部透明拖拽条：home/编辑器统一提供窗口拖拽区，画布背景上探到条后（真全屏）；
        // 编辑器工具条簇单独 no-drag 保证可点击，首页顶部无交互内容不受影响。
        <div
          aria-hidden="true"
          data-testid="canvas-main-drag-region"
          className="absolute inset-x-0 top-0 z-0 h-12 [app-region:drag]"
        />
      ) : null}
      <div className="min-h-0 flex-1">
        {openBoardId ? (
          <CanvasBoard
            workspacePath={workspacePath}
            workspaceIdentity={workspaceIdentity}
            boardId={openBoardId}
            projectName={projectName}
            isDesktop={isDesktop}
            chromeLeftInsetPx={chromeLeftInsetPx}
            chromeRightInsetPx={chromeRightInsetPx}
            onExitCanvas={onExitCanvas}
            onBack={() => setOpenBoardId(null)}
            onOpenBoard={setOpenBoardId}
          />
        ) : (
          <CanvasHome
            workspacePath={workspacePath}
            workspaceIdentity={workspaceIdentity}
            onOpenBoard={setOpenBoardId}
            isDesktop={isDesktop}
          />
        )}
      </div>
    </div>
  );
}
