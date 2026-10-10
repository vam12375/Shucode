import type {
  AppUsageDashboard,
  AppUsageDashboardQuery,
  AppUsageMetrics,
  AppUsageRequestLog,
} from "@shucode/shared";

const NANOS_PER_USD = 1_000_000_000;
const emptyMetrics = (): AppUsageMetrics => ({
  requestCount: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cacheHitRate: 0,
  costUSD: null,
  unpricedCount: 0,
});

function mergeMetrics(parts: readonly AppUsageMetrics[]): AppUsageMetrics {
  const result = emptyMetrics();
  let known = false;
  let costNanos = 0n;
  for (const part of parts) {
    result.requestCount += part.requestCount;
    result.totalTokens += part.totalTokens;
    result.inputTokens += part.inputTokens;
    result.outputTokens += part.outputTokens;
    result.cacheReadTokens += part.cacheReadTokens;
    result.cacheCreationTokens += part.cacheCreationTokens;
    result.unpricedCount += part.unpricedCount;
    if (part.costUSD !== null) {
      known = true;
      costNanos += BigInt(Math.round(part.costUSD * NANOS_PER_USD));
    }
  }
  // 命中率须以总输入加权；逐来源百分比平均会让小样本扭曲总量。
  result.cacheHitRate = result.inputTokens > 0 ? result.cacheReadTokens / result.inputTokens : 0;
  result.costUSD = known ? Number(costNanos) / NANOS_PER_USD : null;
  return result;
}

function groupMetrics<T extends AppUsageMetrics>(
  items: readonly T[],
  key: (item: T) => string,
): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    const group = groups.get(id) ?? [];
    group.push(item);
    groups.set(id, group);
  }
  return [...groups.values()].map((group) => ({ ...group[0]!, ...mergeMetrics(group) }));
}

function compareLogs(left: AppUsageRequestLog, right: AppUsageRequestLog): number {
  if (left.startedAt !== right.startedAt) return right.startedAt - left.startedAt;
  // SQL 游标按 UTF-8 BINARY 排序；JS 的 UTF-16 序会在 Unicode ID 上产生跨页漏项。
  return Buffer.compare(Buffer.from(right.id, "utf8"), Buffer.from(left.id, "utf8"));
}

function compareBuckets(left: { bucket: string }, right: { bucket: string }): number {
  const chronological = Date.parse(left.bucket) - Date.parse(right.bucket);
  if (Number.isFinite(chronological) && chronological !== 0) return chronological;
  return left.bucket === right.bucket ? 0 : left.bucket < right.bucket ? -1 : 1;
}

export function mergeUsageDashboards(
  parts: readonly AppUsageDashboard[],
  query: AppUsageDashboardQuery,
): AppUsageDashboard {
  const until = parts[0]?.pagination.until ?? query.until ?? Date.now();
  if (parts.some((part) => part.pagination.until !== until))
    throw new Error("Usage snapshot boundaries differ");
  const candidates = parts.flatMap((part) => part.logs).sort(compareLogs);
  const logs = candidates.slice(0, query.pageSize);
  const hasMore =
    candidates.length > query.pageSize ||
    parts.some((part) => part.pagination.nextCursor !== undefined);
  const last = logs.at(-1);
  const clientOptions = new Map<string, AppUsageDashboard["clientOptions"][number]>();
  for (const option of parts.flatMap((part) => part.clientOptions)) {
    const existing = clientOptions.get(option.id);
    if (!existing || (!existing.available && option.available))
      clientOptions.set(option.id, option);
  }
  const sourceErrors = new Map(
    parts
      .flatMap((part) => part.sourceErrors)
      .map((error) => [JSON.stringify([error.clientId, error.message]), error]),
  );
  return {
    summary: mergeMetrics(parts.map((part) => part.summary)),
    providers: groupMetrics(
      parts.flatMap((part) => part.providers),
      (item) => JSON.stringify([item.providerId]),
    ).sort((a, b) => b.totalTokens - a.totalTokens),
    models: groupMetrics(
      parts.flatMap((part) => part.models),
      (item) => JSON.stringify([item.providerId, item.modelId]),
    ).sort((a, b) => b.totalTokens - a.totalTokens),
    trend: groupMetrics(
      parts.flatMap((part) => part.trend),
      (item) => item.bucket,
    ).sort(compareBuckets),
    heatmap: groupMetrics(
      parts.flatMap((part) => part.heatmap),
      (item) => item.bucket,
    ).sort(compareBuckets),
    logs,
    clientOptions: [...clientOptions.values()],
    sourceErrors: [...sourceErrors.values()],
    providerOptions: [...new Set(parts.flatMap((part) => part.providerOptions))].sort(),
    modelOptions: [...new Set(parts.flatMap((part) => part.modelOptions))].sort(),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: parts.reduce((sum, part) => sum + part.pagination.total, 0),
      until,
      ...(hasMore && last ? { nextCursor: { startedAt: last.startedAt, id: last.id } } : {}),
    },
  };
}
