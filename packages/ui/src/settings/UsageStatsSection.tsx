import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";

/**
 * 使用统计分区。
 *
 * 二开定制：官方套餐（编程套餐 / 团队套餐 / Start Plan）用量来源已下线，
 * 本页只保留「应用用量」，不再有套餐来源 tab。
 */
export function UsageStatsSection() {
  return <AppUsagePanel />;
}
