import { useMemo, useState } from "react";
import type { AppUsageDashboard } from "@shucode/shared";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import { HeatmapColumn, type HeatmapDisplayColumn } from "./UsageHeatmapCells.js";
import { formatCompactTokenUsage, formatFullDay, formatMonth } from "./usageStatsUiParts.js";
import { formatUsageUSD, type UsageTrendMetric } from "./usageDashboardViewModel.js";

export function UsageDashboardHeatmap({
  dashboard,
  generatedAt,
}: {
  dashboard: AppUsageDashboard;
  generatedAt: number;
}) {
  const { intl, locale } = useShucodeIntl();
  const [metric, setMetric] = useState<UsageTrendMetric>("tokens");
  const columns = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(generatedAt);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    const todayKey = `${get("year")}-${get("month")}-${get("day")}`;
    const today = new Date(`${todayKey}T00:00:00Z`);
    const endWeekStart = today.getTime() - today.getUTCDay() * 86_400_000;
    const start = endWeekStart - 52 * 7 * 86_400_000;
    const entries = new Map(dashboard.heatmap.map((entry) => [entry.bucket, entry]));
    const metricValue = (entry: AppUsageDashboard["heatmap"][number]) =>
      metric === "tokens"
        ? entry.totalTokens
        : metric === "requests"
          ? entry.requestCount
          : entry.costUSD;
    let max = 0;
    for (const entry of dashboard.heatmap) max = Math.max(max, metricValue(entry) ?? 0);
    return Array.from({ length: 53 }, (_, weekIndex): HeatmapDisplayColumn => {
      const weekStart = start + weekIndex * 7 * 86_400_000;
      const monthDate = new Date(weekStart).toISOString().slice(0, 10);
      return {
        key: monthDate,
        monthDate,
        tooltipTitle: null,
        cells: Array.from({ length: 7 }, (_, dayIndex) => {
          const timestamp = weekStart + dayIndex * 86_400_000;
          const date = new Date(timestamp).toISOString().slice(0, 10);
          const entry = entries.get(date);
          const value = entry ? metricValue(entry) : 0;
          const formatted =
            metric === "cost"
              ? formatUsageUSD(locale, value, intl.formatMessage({ id: "usageDashboard.unpriced" }))
              : formatCompactTokenUsage(locale, value ?? 0);
          const unpriced =
            entry?.unpricedCount && metric === "cost"
              ? ` · ${intl.formatMessage({ id: "usageDashboard.unpricedCount" }, { count: entry.unpricedCount })}`
              : "";
          return {
            key: date,
            level:
              value && max
                ? (Math.min(4, Math.max(1, Math.ceil((value / max) * 4))) as 1 | 2 | 3 | 4)
                : 0,
            hasUsage: !!entry?.requestCount,
            columnHover: false,
            tooltipTitle:
              timestamp <= today.getTime()
                ? `${formatFullDay(locale, date)} · ${formatted} ${intl.formatMessage({ id: `usageDashboard.metric.${metric}` })}${unpriced}`
                : undefined,
          };
        }),
      };
    });
  }, [dashboard, generatedAt, intl, locale, metric]);
  return (
    <section
      className="pk-usage-heatmap min-w-0 space-y-3 p-4"
      data-testid="usage-dashboard-heatmap"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ui-base font-medium">
          {intl.formatMessage({ id: "usageDashboard.activity" })}
        </h3>
        <Tabs value={metric} onValueChange={(value) => setMetric(value as UsageTrendMetric)}>
          <TabsList>
            {["tokens", "requests", "cost"].map((value) => (
              <TabsTrigger key={value} value={value} data-testid={`usage-heatmap-metric-${value}`}>
                {intl.formatMessage({ id: `usageDashboard.metric.${value}` })}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-160">
          <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(53,minmax(0,1fr))" }}>
            {columns.map((column) => (
              <HeatmapColumn key={column.key} column={column} mode="daily" />
            ))}
          </div>
          <div
            className="mt-2 grid gap-1"
            style={{ gridTemplateColumns: "repeat(53,minmax(0,1fr))" }}
          >
            {columns.map((column, index) => (
              <div
                key={column.key}
                className="overflow-visible whitespace-nowrap text-ui-xs text-foreground-subtle"
              >
                {index === 0 ||
                column.monthDate.slice(0, 7) !== columns[index - 1]?.monthDate.slice(0, 7)
                  ? formatMonth(locale, column.monthDate)
                  : ""}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
