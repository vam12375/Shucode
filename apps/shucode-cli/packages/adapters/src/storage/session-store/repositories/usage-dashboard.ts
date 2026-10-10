import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { AppUsageDashboard, AppUsageMetrics } from "@shucode/shared";
import type { AppUsageDashboardInput } from "@shucode/contracts";
import { createUsageCost, nanosToUSD } from "./usage-pricing.js";
import {
  dashboardBuckets,
  isHourlyDashboard,
  resolveDashboardRange,
  usageBucket,
} from "./usage-time.js";

const MODEL_COLUMNS = `'shucode:' || id as id, started_at as startedAt, provider_id as providerId, model_id as modelId,
  query_source as querySource, status, retry_count as retryCount,
  input_tokens as inputTokens, output_tokens as outputTokens,
  cache_read_input_tokens as cacheReadTokens, cache_creation_input_tokens as cacheCreationTokens,
  input_tokens + output_tokens as totalTokens, duration_ms as durationMs,
  time_to_first_token_ms as timeToFirstTokenMs`;
const HAS_USAGE = `(provider_total_tokens is not null or input_tokens > 0 or output_tokens > 0
  or cache_read_input_tokens > 0 or cache_creation_input_tokens > 0
  or (json_valid(raw_usage_json) and (
    json_type(raw_usage_json, '$.inputTokens') in ('integer','real')
    or json_type(raw_usage_json, '$.outputTokens') in ('integer','real')
    or json_type(raw_usage_json, '$.totalTokens') in ('integer','real')
    or json_type(raw_usage_json, '$.cacheReadTokens') in ('integer','real')
    or json_type(raw_usage_json, '$.cacheWriteTokens') in ('integer','real'))))`;
const COST = `shucode_usage_cost(provider_id, model_id, input_tokens, output_tokens,
  cache_read_input_tokens, cache_creation_input_tokens, ${HAS_USAGE})`;
const METRICS = `count(*) as requestCount, coalesce(sum(input_tokens + output_tokens),0) as totalTokens,
  coalesce(sum(input_tokens),0) as inputTokens, coalesce(sum(output_tokens),0) as outputTokens,
  coalesce(sum(cache_read_input_tokens),0) as cacheReadTokens,
  coalesce(sum(cache_creation_input_tokens),0) as cacheCreationTokens,
  sum(${COST}) as costNanos, coalesce(sum(case when ${COST} is null then 1 else 0 end),0) as unpricedCount`;
const HISTORY_CHART_DAYS = 53 * 7;
const DAY_MS = 86_400_000;

type Row = Record<string, unknown>;
function metrics(row: Row): AppUsageMetrics {
  const input = Number(row.inputTokens);
  return {
    requestCount: Number(row.requestCount),
    totalTokens: Number(row.totalTokens),
    inputTokens: input,
    outputTokens: Number(row.outputTokens),
    cacheReadTokens: Number(row.cacheReadTokens),
    cacheCreationTokens: Number(row.cacheCreationTokens),
    cacheHitRate: input > 0 ? Number(row.cacheReadTokens) / input : 0,
    costUSD: nanosToUSD(row.costNanos as bigint | null),
    unpricedCount: Number(row.unpricedCount),
  };
}

export async function queryAppUsageDashboard(
  db: DatabaseSync,
  input: AppUsageDashboardInput,
): Promise<AppUsageDashboard> {
  const { query, timeZone, range } = input;
  const until = Math.min(query.until ?? input.until, input.until);
  const bounds = resolveDashboardRange(range, timeZone, until, input.since);
  const hourly = isHourlyDashboard(range, bounds.since, until);
  const cost = createUsageCost(query.prices);
  db.function("shucode_usage_cost", { deterministic: true, varargs: true }, (...args) =>
    cost(
      String(args[0]),
      String(args[1]),
      Number(args[2]),
      Number(args[3]),
      Number(args[4]),
      Number(args[5]),
      Boolean(args[6]),
    ),
  );
  db.function("shucode_usage_bucket", { deterministic: true }, (at) =>
    usageBucket(Number(at), timeZone, hourly),
  );
  db.function("shucode_usage_date", { deterministic: true }, (at) =>
    usageBucket(Number(at), timeZone, false),
  );
  const baseValues: SQLInputValue[] = [bounds.since, until];
  const where = ["started_at >= ?", "started_at <= ?"];
  const values = [...baseValues];
  if (query.providerId !== undefined) {
    where.push("provider_id = ?");
    values.push(query.providerId);
  }
  if (query.modelId !== undefined) {
    where.push("model_id = ?");
    values.push(query.modelId);
  }
  const clause = where.join(" and ");
  const rows = (sql: string, params = values) => {
    const statement = db.prepare(sql);
    statement.setReadBigInts(true);
    return statement.all(...params) as Row[];
  };
  const summary = metrics(rows(`select ${METRICS} from model_usage where ${clause}`)[0]);
  const providers = rows(
    `select provider_id as providerId, ${METRICS} from model_usage where ${clause} group by provider_id order by totalTokens desc`,
  ).map((row) => ({ providerId: String(row.providerId), ...metrics(row) }));
  const models = rows(
    `select provider_id as providerId, model_id as modelId, ${METRICS} from model_usage where ${clause} group by provider_id, model_id order by totalTokens desc`,
  ).map((row) => ({
    providerId: String(row.providerId),
    modelId: String(row.modelId),
    ...metrics(row),
  }));
  // 长期账本摘要包含全部历史；图表仅保留最近53周，避免生成数十年的空桶。
  const chartSince =
    range === "all" ? Math.max(0, until - HISTORY_CHART_DAYS * DAY_MS) : bounds.since;
  const chartClause = `${clause} and started_at >= ?`;
  const chartValues = [...values, chartSince];
  const trendRows = rows(
    `select shucode_usage_bucket(started_at) as bucket, ${METRICS} from model_usage where ${chartClause} group by bucket order by min(started_at)`,
    chartValues,
  );
  const heatmapRows = rows(
    `select shucode_usage_date(started_at) as bucket, ${METRICS} from model_usage where ${chartClause} group by bucket order by bucket`,
    chartValues,
  );
  const trendMap = new Map(trendRows.map((row) => [String(row.bucket), metrics(row)]));
  const firstAt =
    range === "all"
      ? rows(
          `select min(started_at) as firstAt from model_usage where ${chartClause}`,
          chartValues,
        )[0].firstAt
      : bounds.since;
  const start = firstAt === null ? until : Number(firstAt);
  const buckets = dashboardBuckets(start, until, timeZone, hourly).slice(
    range === "all" ? -HISTORY_CHART_DAYS : 0,
  );
  const empty: AppUsageMetrics = {
    requestCount: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheHitRate: 0,
    costUSD: null,
    unpricedCount: 0,
  };
  const trend = buckets.map((bucket) => ({ bucket, ...(trendMap.get(bucket) ?? empty) }));
  const heatmapMap = new Map(heatmapRows.map((row) => [String(row.bucket), metrics(row)]));
  const heatmap = dashboardBuckets(start, until, timeZone, false)
    .slice(range === "all" ? -HISTORY_CHART_DAYS : 0)
    .map((bucket) => ({ bucket, ...(heatmapMap.get(bucket) ?? empty) }));
  const options = rows(
    "select distinct provider_id as providerId, model_id as modelId from model_usage where started_at >= ? and started_at <= ?",
    baseValues,
  );
  const logWhere = query.status ? `${clause} and status = ?` : clause;
  const logValues = query.status ? [...values, query.status] : values;
  const total = Number(
    rows(`select count(*) as total from model_usage where ${logWhere}`, logValues)[0].total,
  );
  const afterWhere = query.after
    ? `${logWhere} and (started_at < ? or (started_at = ? and ('shucode:' || id) < ?))`
    : logWhere;
  const afterValues = query.after
    ? [...logValues, query.after.startedAt, query.after.startedAt, query.after.id]
    : logValues;
  const logRows = rows(
    `select ${MODEL_COLUMNS}, ${COST} as costNanos from model_usage where ${afterWhere}
    order by started_at desc, id desc limit ? offset ?`,
    [...afterValues, query.pageSize + 1, query.after ? 0 : query.page * query.pageSize],
  );
  const logs = logRows.slice(0, query.pageSize).map((row) => ({
    id: String(row.id),
    clientId: "shucode",
    startedAt: Number(row.startedAt),
    providerId: String(row.providerId),
    modelId: String(row.modelId),
    querySource: String(row.querySource),
    status: String(row.status),
    retryCount: Number(row.retryCount),
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    cacheReadTokens: Number(row.cacheReadTokens),
    cacheCreationTokens: Number(row.cacheCreationTokens),
    totalTokens: Number(row.totalTokens),
    durationMs: row.durationMs === null ? null : Number(row.durationMs),
    timeToFirstTokenMs: row.timeToFirstTokenMs === null ? null : Number(row.timeToFirstTokenMs),
    costUSD: nanosToUSD(row.costNanos as bigint | null),
  }));
  const last = logs.at(-1);
  return {
    summary,
    providers,
    models,
    trend,
    heatmap,
    logs,
    clientOptions: [{ id: "shucode", label: "Shucode", available: true }],
    sourceErrors: [],
    providerOptions: [...new Set(options.map((row) => String(row.providerId)))].sort(),
    modelOptions: [...new Set(options.map((row) => String(row.modelId)))].sort(),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      until,
      ...(logRows.length > query.pageSize && last
        ? { nextCursor: { startedAt: last.startedAt, id: last.id } }
        : {}),
    },
  };
}
