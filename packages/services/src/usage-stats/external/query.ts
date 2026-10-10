import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  appUsageDashboardQuerySchema,
  createUsageCost,
  nanosToUSD,
  resolveDashboardRange,
  usageBucket,
  dashboardBuckets,
  isHourlyDashboard,
  type AppUsageDashboard,
  type AppUsageMetrics,
  type AppUsageRequest,
  type UsageModelPrice,
} from "@shucode/shared";

const HISTORY_CHART_DAYS = 53 * 7;
const DAY_MS = 86_400_000;
const COST = `shucode_external_cost(provider_id, model_id, input_tokens, output_tokens,
  cache_read_tokens, cache_creation_tokens, has_usage, native_cost_usd)`;
const METRICS = `count(*) as requestCount, coalesce(sum(input_tokens+output_tokens),0) as totalTokens,
  coalesce(sum(input_tokens),0) as inputTokens, coalesce(sum(output_tokens),0) as outputTokens,
  coalesce(sum(cache_read_tokens),0) as cacheReadTokens, coalesce(sum(cache_creation_tokens),0) as cacheCreationTokens,
  sum(${COST}) as costNanos, coalesce(sum(case when ${COST} is null then 1 else 0 end),0) as unpricedCount`;
type Row = Record<string, unknown>;
const nullableString = (value: unknown) => (value === null ? null : String(value));

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

function createMatchingPrice(prices: readonly UsageModelPrice[]) {
  const exact = new Set(
    prices
      .filter((price) => price.providerId !== undefined)
      .map((price) => JSON.stringify([price.providerId, price.modelId])),
  );
  const generic = new Set(
    prices
      .filter((price) => price.providerId === undefined && price.source === "manual")
      .map((price) => price.modelId),
  );
  return (providerId: string | null, modelId: string | null): boolean =>
    modelId !== null && (generic.has(modelId) || exact.has(JSON.stringify([providerId, modelId])));
}

export function queryExternalUsage(db: DatabaseSync, request: AppUsageRequest): AppUsageDashboard {
  const query = appUsageDashboardQuerySchema.parse(request.dashboard ?? {});
  const timeZone = request.timeZone ?? "UTC";
  const until = request.until ?? query.until ?? Date.now();
  if (request.since !== undefined && request.since > until)
    throw new RangeError("Usage range requires since <= until");
  const bounds = resolveDashboardRange(request.range, timeZone, until, request.since);
  const hourly = isHourlyDashboard(request.range, bounds.since, until);
  const cost = createUsageCost(query.prices);
  const matchingPrice = createMatchingPrice(query.prices);
  db.function("shucode_external_cost", { deterministic: true, varargs: true }, (...args) => {
    const provider = nullableString(args[0]);
    const model = nullableString(args[1]);
    if (matchingPrice(provider, model))
      return cost(
        provider,
        model,
        Number(args[2]),
        Number(args[3]),
        Number(args[4]),
        Number(args[5]),
        Boolean(args[6]),
      );
    const native = args[7];
    return typeof native === "number" && Number.isFinite(native) && native >= 0
      ? BigInt(Math.round(native * 1_000_000_000))
      : null;
  });
  db.function("shucode_external_bucket", { deterministic: true }, (at) =>
    usageBucket(Number(at), timeZone, hourly),
  );
  db.function("shucode_external_date", { deterministic: true }, (at) =>
    usageBucket(Number(at), timeZone, false),
  );
  const baseValues: SQLInputValue[] = [bounds.since, until];
  const clauses = ["started_at >= ?", "started_at <= ?"];
  const values = [...baseValues];
  if (query.clientId !== undefined) {
    clauses.push("client_id = ?");
    values.push(query.clientId);
  }
  if (query.providerId !== undefined) {
    clauses.push("provider_id = ?");
    values.push(query.providerId);
  }
  if (query.modelId !== undefined) {
    clauses.push("model_id = ?");
    values.push(query.modelId);
  }
  const where = clauses.join(" and ");
  const rows = (sql: string, parameters: SQLInputValue[] = values): Row[] => {
    const statement = db.prepare(sql);
    statement.setReadBigInts(true);
    return statement.all(...parameters) as Row[];
  };
  const summary = metrics(rows(`select ${METRICS} from external_usage where ${where}`)[0]!);
  const providers = rows(
    `select provider_id as providerId, ${METRICS} from external_usage where ${where} group by provider_id order by totalTokens desc`,
  ).map((row) => ({ providerId: nullableString(row.providerId), ...metrics(row) }));
  const models = rows(
    `select provider_id as providerId, model_id as modelId, ${METRICS} from external_usage where ${where} group by provider_id, model_id order by totalTokens desc`,
  ).map((row) => ({
    providerId: nullableString(row.providerId),
    modelId: nullableString(row.modelId),
    ...metrics(row),
  }));
  const chartSince =
    request.range === "all" ? Math.max(0, until - HISTORY_CHART_DAYS * DAY_MS) : bounds.since;
  const chartWhere = `${where} and started_at >= ?`;
  const chartValues = [...values, chartSince];
  const trendRows = rows(
    `select shucode_external_bucket(started_at) as bucket, ${METRICS} from external_usage where ${chartWhere} group by bucket order by min(started_at)`,
    chartValues,
  );
  const heatmapRows = rows(
    `select shucode_external_date(started_at) as bucket, ${METRICS} from external_usage where ${chartWhere} group by bucket order by bucket`,
    chartValues,
  );
  const first =
    request.range === "all"
      ? rows(
          `select min(started_at) firstAt from external_usage where ${chartWhere}`,
          chartValues,
        )[0]!.firstAt
      : bounds.since;
  const start = first === null ? until : Number(first);
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
  const mapBuckets = (data: Row[], hour: boolean) => {
    const byBucket = new Map(data.map((row) => [String(row.bucket), metrics(row)]));
    return dashboardBuckets(start, until, timeZone, hour)
      .slice(request.range === "all" ? -HISTORY_CHART_DAYS : 0)
      .map((bucket) => ({ bucket, ...(byBucket.get(bucket) ?? empty) }));
  };
  const options = rows(
    "select distinct provider_id as providerId, model_id as modelId from external_usage where started_at >= ? and started_at <= ?",
    baseValues,
  );
  const logWhere = query.status ? `${where} and status = ?` : where;
  const logValues = query.status ? [...values, query.status] : values;
  const total = Number(
    rows(`select count(*) total from external_usage where ${logWhere}`, logValues)[0]!.total,
  );
  const afterWhere = query.after
    ? `${logWhere} and (started_at < ? or (started_at = ? and id < ?))`
    : logWhere;
  const afterValues = query.after
    ? [...logValues, query.after.startedAt, query.after.startedAt, query.after.id]
    : logValues;
  const logRows = rows(
    `select id, client_id as clientId, started_at as startedAt, provider_id as providerId, model_id as modelId,
    query_source as querySource, status, retry_count as retryCount, input_tokens as inputTokens, output_tokens as outputTokens,
    cache_read_tokens as cacheReadTokens, cache_creation_tokens as cacheCreationTokens, input_tokens+output_tokens as totalTokens,
    duration_ms as durationMs, time_to_first_token_ms as timeToFirstTokenMs, ${COST} as costNanos
    from external_usage where ${afterWhere} order by started_at desc, id desc limit ? offset ?`,
    [...afterValues, query.pageSize + 1, query.after ? 0 : query.page * query.pageSize],
  );
  const logs = logRows.slice(0, query.pageSize).map((row) => ({
    id: String(row.id),
    clientId: String(row.clientId),
    startedAt: Number(row.startedAt),
    providerId: nullableString(row.providerId),
    modelId: nullableString(row.modelId),
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
    ...(row.costNanos !== null
      ? {
          costSource: matchingPrice(nullableString(row.providerId), nullableString(row.modelId))
            ? ("estimated" as const)
            : ("client-reported" as const),
        }
      : {}),
  }));
  const last = logs.at(-1);
  return {
    summary,
    providers,
    models,
    trend: mapBuckets(trendRows, hourly),
    heatmap: mapBuckets(heatmapRows, false),
    logs,
    clientOptions: [],
    sourceErrors: [],
    providerOptions: [
      ...new Set(
        options.flatMap((row) => (row.providerId === null ? [] : [String(row.providerId)])),
      ),
    ].sort(),
    modelOptions: [
      ...new Set(options.flatMap((row) => (row.modelId === null ? [] : [String(row.modelId)]))),
    ].sort(),
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
