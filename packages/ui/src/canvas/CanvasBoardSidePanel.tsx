import { StickyNote } from "lucide-react";
import {
  Clapperboard,
  ChevronLeft,
  FileText,
  Image as ImageIcon,
  Music,
  Video,
} from "lucide-react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import type { CanvasNode } from "@/lib/canvasBoard.js";
import {
  TID_CANVAS_EMPTY_ACTIONS,
  TID_CANVAS_PANEL,
  TID_CANVAS_PANEL_COLLAPSE,
  TID_CANVAS_PANEL_NODE_ITEM,
  TID_CANVAS_PANEL_TAB_ASSETS,
  TID_CANVAS_PANEL_TAB_NODES,
  testId,
} from "@shucode/shared";

export type CanvasPanelTab = "nodes" | "assets";

interface CanvasBoardSidePanelProps {
  nodes: CanvasNode[];
  tab: CanvasPanelTab;
  onTabChange: (tab: CanvasPanelTab) => void;
  /** 节点条目点击：编辑器负责把对应节点居中聚焦。 */
  onFocusNode: (nodeId: string) => void;
  onCollapse: () => void;
  /** 桌面端面板从 48px 拖拽条下开始，避开 macOS 红绿灯等窗控安全区。 */
  offsetTopStrip?: boolean;
}

interface PanelTabButtonProps {
  testIdValue: string;
  active: boolean;
  label: string;
  onSelect: () => void;
}

function PanelTabButton({ testIdValue, active, label, onSelect }: PanelTabButtonProps) {
  return (
    <button
      type="button"
      data-testid={testIdValue}
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "rounded-md px-2 py-1 text-ui-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-selected font-medium text-foreground"
          : "text-foreground-subtle hover:bg-hover hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

/**
 * 详情页左侧节点/资产面板（参考 libtv）：默认展开挂画布左缘，
 * 底部为「收起」按钮与节点计数；收起态由编辑器画布左下角「资产管理」重开。
 */
export function CanvasBoardSidePanel({
  nodes,
  tab,
  onTabChange,
  onFocusNode,
  onCollapse,
  offsetTopStrip = false,
}: CanvasBoardSidePanelProps) {
  const { intl } = useShucodeIntl();
  const displayedNodes = [...nodes].reverse();

  return (
    <aside
      data-testid={TID_CANVAS_PANEL}
      className={cn(
        "flex w-64 shrink-0 flex-col border-r border-border bg-sidebar",
        offsetTopStrip && "mt-12",
      )}
    >
      <div className="flex shrink-0 items-center gap-1 px-2.5 pt-2.5">
        <PanelTabButton
          testIdValue={TID_CANVAS_PANEL_TAB_NODES}
          active={tab === "nodes"}
          label={intl.formatMessage({ id: "canvas.panelTabNodes" })}
          onSelect={() => onTabChange("nodes")}
        />
        <PanelTabButton
          testIdValue={TID_CANVAS_PANEL_TAB_ASSETS}
          active={tab === "assets"}
          label={intl.formatMessage({ id: "canvas.panelTabAssets" })}
          onSelect={() => onTabChange("assets")}
        />
      </div>
      {tab === "nodes" ? (
        nodes.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-start px-4 pt-6">
            <span className="text-ui-sm text-foreground-subtlest">
              {intl.formatMessage({ id: "canvas.panelNodesEmpty" })}
            </span>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {displayedNodes.map((node) => (
              <button
                key={node.id}
                type="button"
                data-testid={testId(TID_CANVAS_PANEL_NODE_ITEM, node.id)}
                onClick={() => onFocusNode(node.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-sm text-foreground outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
              >
                <StickyNote className="size-4 shrink-0 text-foreground-subtlest" />
                <span className="min-w-0 truncate">
                  {node.data.text.trim() ||
                    intl.formatMessage({ id: "canvas.panelNodeUntitled" })}
                </span>
              </button>
            ))}
          </div>
        )
      ) : (
        // 资产 Tab 本期占位：与首页能力磁贴同规则，生成模型接入后展示产出归集。
        <div className="flex min-h-0 flex-1 flex-col items-start gap-1.5 px-4 pt-6">
          <span className="text-ui-sm text-foreground-subtlest">
            {intl.formatMessage({ id: "canvas.panelAssetsEmpty" })}
          </span>
          <em className="text-ui-xs not-italic text-foreground-subtlest">
            {intl.formatMessage({ id: "canvasHome.comingSoon" })}
          </em>
        </div>
      )}
      <div className="flex shrink-0 items-center justify-between border-t border-border py-1.5 pl-1.5 pr-3">
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid={TID_CANVAS_PANEL_COLLAPSE}
          aria-label={intl.formatMessage({ id: "canvas.panelCollapse" })}
          onClick={onCollapse}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-ui-xs tabular-nums text-foreground-subtlest">
          {intl.formatMessage({ id: "canvas.nodeCount" }, { n: nodes.length })}
        </span>
      </div>
    </aside>
  );
}

/** 中央空态的生成能力占位 chips：与首页磁贴同规则（禁用 + 「即将上线」），生成模型接入后转真实入口。 */
const EMPTY_STATE_ACTIONS: ReadonlyArray<{
  messageId: string;
  Icon: ComponentType<{ className?: string }>;
}> = [
  { messageId: "canvas.actionImage", Icon: ImageIcon },
  { messageId: "canvas.actionVideo", Icon: Video },
  { messageId: "canvas.actionAudio", Icon: Music },
  { messageId: "canvas.actionScript", Icon: FileText },
  { messageId: "canvas.actionEdit", Icon: Clapperboard },
];

/** 详情页中央空态（仅画布无节点时由编辑器挂载）：外层不拦截指针，双击/拖拽画布不受影响。 */
export function CanvasBoardEmptyState() {
  const { intl } = useShucodeIntl();
  return (
    <div
      data-testid={TID_CANVAS_EMPTY_ACTIONS}
      className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-6"
    >
      <span className="text-ui-lg text-foreground-subtle">
        {intl.formatMessage({ id: "canvas.emptyHint" })}
      </span>
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2.5">
        {EMPTY_STATE_ACTIONS.map(({ messageId, Icon }) => (
          <button
            key={messageId}
            type="button"
            disabled
            title={intl.formatMessage({ id: "canvasHome.comingSoon" })}
            className="flex h-12 cursor-not-allowed items-center gap-2.5 rounded-lg border border-border bg-card px-4 text-ui-base text-foreground-subtle"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary">
              <Icon className="size-4" />
            </span>
            {intl.formatMessage({ id: messageId })}
          </button>
        ))}
      </div>
    </div>
  );
}
