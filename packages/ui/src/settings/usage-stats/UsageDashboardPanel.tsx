import { RefreshCcw, Info } from "lucide-react";
import { lazy, useCallback, useRef, useState } from "react";
import type { AppUsageRange, UsageCursor } from "@shucode/shared";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import { useAppUsageStats } from "@/hooks/useUsageStats.js";
import { AppUsagePanel } from "./AppUsagePanel.js";
import { UsageChartLoadBoundary } from "./UsageChartLoadBoundary.js";
import { UsageDashboardTables } from "./UsageDashboardTables.js";
import { UsageIconButton, UsageSelect } from "./UsageDashboardControls.js";
import { UsagePricingPanel } from "./UsagePricingPanel.js";
import { UsageStatsErrorNotice } from "./UsageStatsErrorNotice.js";
import { formatCompactTokenUsage, formatPercent, UsageEmptyState } from "./usageStatsUiParts.js";
import { formatUsageUSD, type UsageTrendMetric } from "./usageDashboardViewModel.js";
import {
  UsageClientSelector,
  UsageScopeSelector,
  type UsageClientId,
  type UsageScope,
} from "./UsageClientSelector.js";
import { UsageCustomRange } from "./UsageCustomRange.js";
import { UsageDashboardHeatmap } from "./UsageDashboardHeatmap.js";

const UsageDashboardTrend = lazy(() =>
  import("./UsageDashboardTrend.js").then((module) => ({ default: module.UsageDashboardTrend })),
);
const VIEWS = ["logs", "providers", "models", "pricing", "activities"] as const;
type DashboardView = (typeof VIEWS)[number];

export function UsageDashboardPanel({
  scope: controlledScope,
  onScopeChange,
}: { scope?: UsageScope; onScopeChange?: (scope: UsageScope) => void } = {}) {
  const { intl, locale } = useShucodeIntl();
  const [range, setRange] = useState<AppUsageRange>("today");
  const [providerId, setProvider] = useState("");
  const [modelId, setModel] = useState("");
  const [status, setStatus] = useState<"completed" | "error" | "cancelled" | undefined>();
  const [paging, setPaging] = useState<{ page: number; until?: number; after?: UsageCursor }>({
    page: 0,
  });
  const cursors = useRef(new Map<number, UsageCursor | undefined>());
  const [view, setView] = useState<DashboardView>("logs");
  const [metric, setMetric] = useState<UsageTrendMetric>("tokens");
  const [refreshSeconds, setRefreshSeconds] = useState("30");
  const [internalScope, setInternalScope] = useState<UsageScope>("shucode");
  const [clientId, setClientId] = useState<UsageClientId>();
  const [customRange, setCustomRange] = useState<{ since: number; until?: number }>(() => ({
    since: Date.now() - 7 * 24 * 60 * 60 * 1000,
  }));
  const scope = controlledScope ?? internalScope;
  const { snapshot, loading, error, refresh, refreshOnNextQuery } = useAppUsageStats(range, {
    since: range === "custom" ? customRange.since : undefined,
    until: range === "custom" ? customRange.until : undefined,
    dashboard: {
      scope,
      clientId: scope === "all-clients" ? clientId : undefined,
      providerId: providerId || undefined,
      modelId: modelId || undefined,
      status,
      page: paging.page,
      pageSize: 20,
      until: paging.until,
      after: paging.after,
    },
    autoRefreshMs:
      paging.page === 0 && paging.until === undefined ? Number(refreshSeconds) * 1000 : 0,
  });
  const dashboard = snapshot?.dashboard;
  // 修改价格后旧的进行中查询仍携带旧价快照，必须失效并重新读取当前价格。
  const refreshPricing = useCallback(() => refresh(true), [refresh]);
  const msg = (key: string) => intl.formatMessage({ id: `usageDashboard.${key}` });
  const resetPage = () => {
    cursors.current.clear();
    setPaging({ page: 0 });
  };
  const summary = dashboard?.summary;
  const summaryItems = [
    {
      key: "cost",
      value: summary ? formatUsageUSD(locale, summary.costUSD, msg("unpriced")) : "--",
    },
    { key: "requests", value: summary ? summary.requestCount.toLocaleString(locale) : "--" },
    { key: "tokens", value: summary ? formatCompactTokenUsage(locale, summary.totalTokens) : "--" },
    { key: "cacheHit", value: summary ? formatPercent(locale, summary.cacheHitRate) : "--" },
  ];
  return (
    <div className="pk-usage-dashboard min-w-0 space-y-5" data-testid="usage-dashboard">
      {controlledScope === undefined ? (
        <div className="flex justify-end">
          <UsageScopeSelector
            scope={scope}
            onChange={(value) => {
              setInternalScope(value);
              onScopeChange?.(value);
              setProvider("");
              setModel("");
              resetPage();
            }}
          />
        </div>
      ) : null}
      {scope === "all-clients" ? (
        <UsageClientSelector
          options={dashboard?.clientOptions ?? []}
          clientId={clientId}
          onChange={(value) => {
            setClientId(value);
            setProvider("");
            setModel("");
            resetPage();
          }}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-2">
          <UsageSelect
            label={msg("provider")}
            value={providerId || "__all__"}
            testId="usage-provider-filter"
            onChange={(value) => {
              setProvider(value === "__all__" ? "" : value);
              resetPage();
            }}
            options={[
              { value: "__all__", label: msg("allProviders") },
              ...[
                ...new Set([
                  ...(providerId ? [providerId] : []),
                  ...(dashboard?.providerOptions ?? []),
                ]),
              ].map((value) => ({ value, label: value })),
            ]}
          />
          <UsageSelect
            label={msg("model")}
            value={modelId || "__all__"}
            testId="usage-model-filter"
            onChange={(value) => {
              setModel(value === "__all__" ? "" : value);
              resetPage();
            }}
            options={[
              { value: "__all__", label: msg("allModels") },
              ...[
                ...new Set([...(modelId ? [modelId] : []), ...(dashboard?.modelOptions ?? [])]),
              ].map((value) => ({ value, label: value })),
            ]}
          />
          <UsageSelect
            label={intl.formatMessage({ id: "settings.usage.appUsageRangeTitle" })}
            value={range}
            testId="usage-range-filter"
            onChange={(value) => {
              setRange(value as AppUsageRange);
              resetPage();
            }}
            options={["today", "24h", "7d", "14d", "30d", "all", "custom"].map((value) => ({
              value,
              label: intl.formatMessage({ id: `settings.usage.range.${value}` }),
            }))}
          />
        </div>
        <div className="flex items-center gap-2">
          <UsageSelect
            label={msg("autoRefresh")}
            value={refreshSeconds}
            testId="usage-auto-refresh"
            onChange={setRefreshSeconds}
            options={[
              { value: "0", label: msg("refreshOff") },
              ...["30", "60"].map((value) => ({
                value,
                label: intl.formatMessage({ id: "usageDashboard.seconds" }, { seconds: value }),
              })),
            ]}
          />
          <UsageIconButton
            label={intl.formatMessage({ id: "settings.usage.refresh" })}
            testId="usage-refresh"
            disabled={loading}
            onClick={() => {
              if (paging.until !== undefined) {
                refreshOnNextQuery(true);
                resetPage();
              } else void refresh(false, true);
            }}
          >
            <RefreshCcw className={loading ? "animate-spin" : ""} />
          </UsageIconButton>
        </div>
      </div>
      {range === "custom" ? (
        <UsageCustomRange
          value={customRange}
          onChange={(value) => {
            setCustomRange(value);
            resetPage();
          }}
        />
      ) : null}
      <div className="pk-usage-summary pk-usage-dashboard-summary grid grid-cols-2 overflow-hidden rounded-xl bg-surface sm:grid-cols-4">
        {summaryItems.map((item) => (
          <div
            key={item.key}
            className="pk-usage-stat min-w-0 px-4 py-3"
            data-testid={`usage-summary-${item.key}`}
          >
            <div className="flex items-center gap-1 text-ui-sm text-foreground-subtle">
              {msg(item.key === "cost" ? "totalCost" : item.key)}
              {item.key === "cost" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button aria-label={msg("costHint")} className="size-5 shrink-0">
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{msg("costHint")}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <div className="mt-1 truncate font-mono text-ui-xl font-medium tabular-nums">
              {item.value}
            </div>
            {item.key === "cost" && summary?.unpricedCount ? (
              <div className="mt-1 text-ui-xs text-foreground-subtle">
                {intl.formatMessage(
                  { id: "usageDashboard.unpricedCount" },
                  { count: summary.unpricedCount },
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {error ? <UsageStatsErrorNotice error={error} /> : null}
      {dashboard?.sourceErrors.map((failure) => (
        <p key={failure.clientId} role="status" className="break-words text-ui-sm text-warning">
          {intl.formatMessage(
            { id: "usageDashboard.sourceError" },
            { client: failure.clientId, message: failure.message },
          )}
        </p>
      ))}
      {range === "all" && dashboard ? (
        <UsageDashboardHeatmap dashboard={dashboard} generatedAt={snapshot.generatedAt} />
      ) : (
        <div className="pk-usage-chart space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-ui-base font-medium">{msg("trend")}</h3>
            <Tabs value={metric} onValueChange={(value) => setMetric(value as UsageTrendMetric)}>
              <TabsList>
                {["tokens", "requests", "cost"].map((value) => (
                  <TabsTrigger key={value} value={value} data-testid={`usage-metric-${value}`}>
                    {msg(`metric.${value}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          {dashboard ? (
            <UsageChartLoadBoundary
              scope="settings.usage.dashboard-trend"
              resetKeys={[snapshot?.generatedAt, range, metric]}
              loadingDescription={intl.formatMessage({
                id: "settings.usage.appUsageLoadingDescription",
              })}
            >
              <UsageDashboardTrend dashboard={dashboard} metric={metric} range={range} />
            </UsageChartLoadBoundary>
          ) : (
            <UsageEmptyState
              title={intl.formatMessage({
                id: loading ? "settings.usage.loadingTitle" : "settings.usage.emptyTitle",
              })}
              description={intl.formatMessage({
                id: loading
                  ? "settings.usage.appUsageLoadingDescription"
                  : "settings.usage.emptyDescription",
              })}
            />
          )}
        </div>
      )}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
          <Tabs
            className="min-w-0 max-w-full overflow-x-auto"
            value={view}
            onValueChange={(value) => setView(value as DashboardView)}
          >
            <TabsList className="w-max bg-transparent">
              {VIEWS.filter((value) => scope === "shucode" || value !== "activities").map(
                (value) => (
                  <TabsTrigger key={value} value={value} data-testid={`usage-tab-${value}`}>
                    {msg(`tab.${value}`)}
                  </TabsTrigger>
                ),
              )}
            </TabsList>
          </Tabs>
          {view === "logs" ? (
            <UsageSelect
              label={msg("status")}
              value={status ?? "__all__"}
              testId="usage-status-filter"
              onChange={(value) => {
                setStatus(value === "__all__" ? undefined : (value as typeof status));
                resetPage();
              }}
              options={[
                { value: "__all__", label: msg("allStatuses") },
                ...["completed", "error", "cancelled"].map((value) => ({
                  value,
                  label: msg(`status.${value}`),
                })),
              ]}
            />
          ) : null}
        </div>
        {view === "pricing" ? (
          <UsagePricingPanel onChanged={refreshPricing} />
        ) : view === "activities" ? (
          scope === "all-clients" ? (
            dashboard ? (
              <UsageDashboardHeatmap dashboard={dashboard} generatedAt={snapshot.generatedAt} />
            ) : null
          ) : (
            <AppUsagePanel showSummary={false} />
          )
        ) : dashboard ? (
          <UsageDashboardTables
            dashboard={dashboard}
            view={view}
            loading={loading}
            onPageChange={(page, until) => {
              if (page > paging.page) cursors.current.set(page, dashboard.pagination.nextCursor);
              setPaging({ page, until, after: cursors.current.get(page) });
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
