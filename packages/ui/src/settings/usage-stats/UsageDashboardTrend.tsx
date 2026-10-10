import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { AppUsageDashboard, AppUsageRange } from "@shucode/shared";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import { formatCompactTokenUsage } from "./usageStatsUiParts.js";
import { formatUsageUSD, type UsageTrendMetric } from "./usageDashboardViewModel.js";

export function UsageDashboardTrend({
  dashboard,
  metric,
  range,
}: {
  dashboard: AppUsageDashboard;
  metric: UsageTrendMetric;
  range: AppUsageRange;
}) {
  const { intl, locale } = useShucodeIntl();
  const label = intl.formatMessage({ id: `usageDashboard.metric.${metric}` });
  const config = useMemo(
    () => ({ value: { label, color: "var(--color-usage-chart-1)" } }),
    [label],
  );
  const data = useMemo(
    () =>
      dashboard.trend.map((entry) => ({
        label: entry.bucket.includes("T")
          ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
              new Date(entry.bucket),
            )
          : entry.bucket.slice(5),
        bucket: entry.bucket,
        tooltipLabel: entry.bucket.includes("T")
          ? new Intl.DateTimeFormat(locale, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZoneName: "shortOffset",
            }).format(new Date(entry.bucket))
          : entry.bucket,
        unpricedCount: entry.unpricedCount,
        value:
          metric === "tokens"
            ? entry.totalTokens
            : metric === "requests"
              ? entry.requestCount
              : entry.costUSD,
      })),
    [dashboard, metric, range, locale],
  );
  const formatValue = (value: number | null) =>
    metric === "cost"
      ? formatUsageUSD(locale, value, intl.formatMessage({ id: "usageDashboard.unpriced" }))
      : formatCompactTokenUsage(locale, value ?? 0);
  return (
    <ChartContainer config={config} className="h-56 w-full" data-testid="usage-trend-chart">
      <BarChart accessibilityLayer data={data} margin={{ top: 12, left: 8, right: 12, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis width={54} tickLine={false} axisLine={false} tickFormatter={formatValue} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) => String(payload[0]?.payload?.tooltipLabel ?? "")}
              formatter={(value, _name, item) => (
                <span className="font-mono tabular-nums">
                  {formatValue(typeof value === "number" ? value : null)}
                  {metric === "cost" && item.payload?.unpricedCount ? (
                    <span className="ml-2 text-ui-xs text-foreground-subtle">
                      {intl.formatMessage(
                        { id: "usageDashboard.unpricedCount" },
                        { count: item.payload.unpricedCount },
                      )}
                    </span>
                  ) : null}
                </span>
              )}
            />
          }
        />
        <Bar
          dataKey="value"
          fill="var(--color-value)"
          radius={[3, 3, 0, 0]}
          maxBarSize={42}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}
