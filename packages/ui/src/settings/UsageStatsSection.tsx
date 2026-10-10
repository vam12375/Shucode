import { UsageDashboardPanel } from "@/settings/usage-stats/UsageDashboardPanel.js";
import type { UsageScope } from "@/settings/usage-stats/UsageClientSelector.js";

/**
 * 使用统计分区。
 *
 * 二开定制：官方套餐（编程套餐 / 团队套餐 / Start Plan）用量来源已下线，
 * 本页只保留「应用用量」，不再有套餐来源 tab。
 */
export function UsageStatsSection({
  scope,
  onScopeChange,
}: { scope?: UsageScope; onScopeChange?: (scope: UsageScope) => void } = {}) {
  return <UsageDashboardPanel scope={scope} onScopeChange={onScopeChange} />;
}
