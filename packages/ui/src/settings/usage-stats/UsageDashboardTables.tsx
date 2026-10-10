import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AppUsageDashboard } from "@shucode/shared";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import { UsageIconButton, USAGE_TABLE_CLASS } from "./UsageDashboardControls.js";
import { formatCompactTokenUsage, formatPercent, resolveModelLabel } from "./usageStatsUiParts.js";
import { formatUsageUSD } from "./usageDashboardViewModel.js";
import { UsageClientIcon } from "./UsageClientSelector.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";

export function UsageDashboardTables({
  dashboard,
  view,
  onPageChange,
  loading,
}: {
  dashboard: AppUsageDashboard;
  view: "logs" | "providers" | "models";
  onPageChange: (page: number, until: number) => void;
  loading: boolean;
}) {
  const { intl, locale } = useShucodeIntl();
  const msg = (key: string) => intl.formatMessage({ id: `usageDashboard.${key}` });
  const money = (value: number | null) => formatUsageUSD(locale, value, msg("unpriced"));
  const token = (value: number) => formatCompactTokenUsage(locale, value);
  const provider = (id: string | null) => id || msg("unknownProvider");
  const headers =
    view === "logs"
      ? [
          "time",
          "client",
          "provider",
          "model",
          "input",
          "output",
          "cacheRead",
          "cacheWrite",
          "cost",
          "status",
          "source",
          "retry",
          "duration",
        ]
      : [
          ...(view === "models" ? ["provider", "model"] : ["provider"]),
          "requests",
          "tokens",
          "cacheHit",
          "cost",
        ];
  const rows =
    view === "logs" ? dashboard.logs : view === "models" ? dashboard.models : dashboard.providers;
  const { page, pageSize, total, until } = dashboard.pagination;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="min-w-0" data-testid={`usage-table-${view}`}>
      <div className="max-w-full overflow-x-auto">
        <table className={USAGE_TABLE_CLASS}>
          <thead className="border-b border-border">
            <tr>
              {headers.map((header) => (
                <th key={header}>{msg(header)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view === "logs"
              ? dashboard.logs.map((log) => (
                  <tr key={log.id}>
                    <td className="font-mono tabular-nums">
                      {new Intl.DateTimeFormat(locale, {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(log.startedAt)}
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <UsageClientIcon id={log.clientId} />
                        <span>
                          {dashboard.clientOptions.find((client) => client.id === log.clientId)
                            ?.label ?? log.clientId}
                        </span>
                      </span>
                    </td>
                    <td>{provider(log.providerId)}</td>
                    <td className="font-mono">{resolveModelLabel(intl, log.modelId)}</td>
                    <td className="font-mono tabular-nums">
                      {token(
                        Math.max(
                          0,
                          log.inputTokens - log.cacheReadTokens - log.cacheCreationTokens,
                        ),
                      )}
                    </td>
                    <td className="font-mono tabular-nums">{token(log.outputTokens)}</td>
                    <td className="font-mono tabular-nums">{token(log.cacheReadTokens)}</td>
                    <td className="font-mono tabular-nums">{token(log.cacheCreationTokens)}</td>
                    <td className="font-mono tabular-nums">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help">{money(log.costUSD)}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {msg(
                            log.costSource === "client-reported"
                              ? "costClientReported"
                              : "costEstimated",
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    <td
                      className={
                        log.status === "error" ? "text-destructive" : "text-foreground-subtle"
                      }
                    >
                      {["completed", "error", "cancelled"].includes(log.status)
                        ? msg(`status.${log.status}`)
                        : msg("unknownStatus")}
                    </td>
                    <td className="text-foreground-subtle">{log.querySource}</td>
                    <td className="font-mono tabular-nums">{log.retryCount}</td>
                    <td className="font-mono tabular-nums">
                      {log.durationMs === null ? "--" : `${(log.durationMs / 1000).toFixed(1)}s`}
                    </td>
                  </tr>
                ))
              : (view === "models" ? dashboard.models : dashboard.providers).map((row) => (
                  <tr key={JSON.stringify([row.providerId, "modelId" in row ? row.modelId : null])}>
                    <td>{provider(row.providerId)}</td>
                    {"modelId" in row ? (
                      <td className="font-mono">
                        {resolveModelLabel(
                          intl,
                          typeof row.modelId === "string" ? row.modelId : null,
                        )}
                      </td>
                    ) : null}
                    <td className="font-mono tabular-nums">
                      {row.requestCount.toLocaleString(locale)}
                    </td>
                    <td className="font-mono tabular-nums">{token(row.totalTokens)}</td>
                    <td className="font-mono tabular-nums">
                      {formatPercent(locale, row.cacheHitRate)}
                    </td>
                    <td className="font-mono tabular-nums">
                      {money(row.costUSD)}
                      {row.unpricedCount ? (
                        <span className="ml-2 text-ui-xs text-foreground-subtle">
                          {intl.formatMessage(
                            { id: "usageDashboard.unpricedCount" },
                            { count: row.unpricedCount },
                          )}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
            {!rows.length ? (
              <tr>
                <td colSpan={headers.length} className="h-28 text-center text-foreground-subtle">
                  {msg("noData")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {view === "logs" ? (
        <div className="mt-3 flex items-center justify-end gap-3">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage(
              { id: "usageDashboard.pagination" },
              { page: page + 1, pages, total },
            )}
          </span>
          <UsageIconButton
            label={msg("previous")}
            testId="usage-page-previous"
            disabled={loading || page === 0}
            onClick={() => onPageChange(page - 1, until)}
          >
            <ChevronLeft />
          </UsageIconButton>
          <UsageIconButton
            label={msg("next")}
            testId="usage-page-next"
            disabled={loading || page + 1 >= pages}
            onClick={() => onPageChange(page + 1, until)}
          >
            <ChevronRight />
          </UsageIconButton>
        </div>
      ) : null}
    </div>
  );
}
