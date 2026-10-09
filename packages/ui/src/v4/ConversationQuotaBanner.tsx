import { InfoIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import type {
  SessionQuotaBannerKind,
  SessionQuotaBannerState,
} from "@/v4/sessionQuotaBannerState.js";

const MESSAGE_IDS: Record<SessionQuotaBannerKind, string> = {
  "daily-exhausted": "chat.quota.startPlan.dailyExhausted",
  "concurrent-limit": "chat.quota.startPlan.concurrentLimit",
  "provider-limited": "chat.quota.providerLimited",
  "mcp-quota-exhausted": "chat.quota.mcp.quotaExhausted",
  "mcp-plan-required": "chat.quota.mcp.codingPlanRequired",
};

function resolveMessageId(state: SessionQuotaBannerState): string {
  if (state.kind === "concurrent-limit") {
    return state.concurrentLimitReason === "retry-exhausted-busy"
      ? "chat.quota.startPlan.concurrentLimit.retryExhausted"
      : "chat.quota.startPlan.concurrentLimit";
  }
  return state.kind ? MESSAGE_IDS[state.kind] : "";
}

// 二开定制：官方套餐额度提醒已删除，额度横幅只保留服务端业务错误与 MCP 提示；
// 横幅文案一律走 i18n，不再有本地额度/百分比插值。
export function ConversationQuotaBanner({
  state,
  onDismiss,
}: {
  state: SessionQuotaBannerState;
  onDismiss: () => void;
}) {
  const { intl } = useShucodeIntl();
  if (!state.visible || !state.kind) return null;

  const message =
    state.kind === "provider-limited" && state.providerLimitedMessage
      ? state.providerLimitedMessage
      : intl.formatMessage(
          { id: resolveMessageId(state) },
          {
            model: state.modelName ?? "",
            // MCP 提示点名具体 server；服务端那句是英文的，界面文案一律走 i18n。
            server: state.mcpServerName ?? "",
          },
        );

  return (
    <div className="mb-3 w-full px-4 max-md:px-2" data-testid="v4-session-quota-banner">
      <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-ui-base text-foreground">
          <InfoIcon className="size-4 shrink-0" />
          <div className="min-w-0 break-words">{message}</div>
        </div>
        {state.dismissible ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onDismiss}
            aria-label={intl.formatMessage({ id: "common.close" })}
            className="shrink-0 rounded-full text-foreground-subtle hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
