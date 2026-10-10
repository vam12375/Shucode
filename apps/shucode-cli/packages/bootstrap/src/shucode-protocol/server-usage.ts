import type { UsageStorePort } from "@shucode/contracts";
import { shucodeUsageStatsParamsSchema } from "@shucode/shared";
import { buildAppUsageSnapshot, resolveTzOffsetMs } from "./usage-stats-builder.js";
import {
  parseParams,
  ProtocolRequestError,
  type ShucodeProtocolAgentServerContext,
} from "./server-types.js";

const APP_USAGE_RANGE_DAYS: Record<string, number> = {
  today: 1,
  "24h": 1,
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

export async function getUsageStats(
  context: ShucodeProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(shucodeUsageStatsParamsSchema, rawParams ?? {});
  const timeZone = params.timeZone ?? "UTC";
  const until = Math.min(params.until ?? params.dashboard?.until ?? Date.now(), Date.now());
  if (params.since !== undefined && params.since > until) {
    throw new ProtocolRequestError(-32602, "Usage range since must not exceed until");
  }
  if (params.range === "custom" && params.since === undefined) {
    throw new ProtocolRequestError(-32602, "Custom usage range requires since");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(until);
  } catch (error) {
    throw new ProtocolRequestError(-32602, "Usage timeZone must be an IANA time zone", error);
  }
  const tzOffsetMs = resolveTzOffsetMs(timeZone, until);
  const rangeDays = APP_USAGE_RANGE_DAYS[params.range] ?? 30;
  const since =
    params.range === "custom"
      ? params.since!
      : params.range === "all"
        ? 0
        : until - rangeDays * 86_400_000;
  const buildOptions = {
    range: params.range,
    timeZone,
    tzOffsetMs,
    generatedAt: until,
    since,
    until,
  };
  const usageStore = context.deps.sessionStore as Partial<UsageStorePort> | undefined;
  const dashboard = params.dashboard
    ? await requireDashboardStore(usageStore).queryAppUsageDashboard({
        range: params.range,
        timeZone,
        since: params.since,
        until,
        query: params.dashboard,
      })
    : undefined;
  if (!usageStore?.queryAppUsage) {
    return buildAppUsageSnapshot(
      {
        totals: {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          modelRequestCount: 0,
          modelErrorCount: 0,
          avgTimeToFirstTokenMs: null,
        },
        turnTotals: {
          totalSessions: 0,
          totalTurns: 0,
          avgTurnDurationMs: null,
          longestSessionMs: 0,
        },
        toolTotals: { toolCallCount: 0, toolErrorCount: 0 },
        models: [],
        tools: [],
        days: [],
        dayModels: [],
      },
      buildOptions,
    );
  }
  const result = await usageStore.queryAppUsage({ since, until, tzOffsetMs });
  return { ...buildAppUsageSnapshot(result, buildOptions), ...(dashboard ? { dashboard } : {}) };
}

function requireDashboardStore(
  store: Partial<UsageStorePort> | undefined,
): Pick<UsageStorePort, "queryAppUsageDashboard"> {
  if (!store?.queryAppUsageDashboard) throw new Error("Usage dashboard store is unavailable");
  return { queryAppUsageDashboard: store.queryAppUsageDashboard.bind(store) };
}
