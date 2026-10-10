import type { IUsageStatsService } from "@shucode/services";
import {
  APP_USAGE_STATUSES,
  USAGE_CLIENT_IDS,
  appUsageSnapshotSchema,
  createUsageCost,
  usagePriceKey,
} from "@shucode/shared";
import type {
  AppUsageDashboard,
  AppUsageMetrics,
  AppUsageRequest,
  AppUsageRequestLog,
  UsageModelPrice,
  UsagePricingSettings,
} from "@shucode/shared";

const NOW = Date.now();
const labels = [
  "Shucode",
  "Codex",
  "Claude Code",
  "DSH Desktop",
  "Pi",
  "Gemini",
  "OpenCode",
  "Grok Build",
  "MiniMax Code",
];
const baseMetrics = (): AppUsageMetrics => ({
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
const catalog: UsageModelPrice[] = ["catalog-alpha", "catalog-beta", "catalog-gamma"].map(
  (modelId, index) => ({
    modelId,
    providerId: "fixture-provider",
    inputUSD: index + 1,
    outputUSD: index + 2,
    cacheReadUSD: 0.1,
    cacheWriteUSD: 0.5,
    source: "models-dev",
    catalogKey: `fixture-provider/${modelId}`,
  }),
);
let settings: UsagePricingSettings = {
  entries: [
    {
      modelId: "fixture-model",
      inputUSD: 2,
      outputUSD: 4,
      cacheReadUSD: 0.1,
      cacheWriteUSD: 0.5,
      source: "manual",
    },
  ],
  modelsDevAutoSync: false,
  modelsDevSelectedKeys: [],
  lastSyncedAt: null,
};
let held: { resolve: () => void; request: AppUsageRequest } | null = null;
let holdNext = false;
let pendingCount = 0;
let legacyImportCcSwitch = false;
const records: AppUsageRequestLog[] = Array.from({ length: 60 }, (_, index) => ({
  id: `fixture-${String(index).padStart(3, "0")}`,
  startedAt: NOW - index * 180_000,
  clientId: index < 50 ? "shucode" : USAGE_CLIENT_IDS[(index % 5) + 1],
  providerId: index % 2 ? "fixture-provider" : "secondary-provider",
  modelId: index % 3 ? "fixture-model" : "fixture-unpriced",
  querySource: "fixture-model-call",
  status: APP_USAGE_STATUSES[index % 3],
  retryCount: index % 3,
  inputTokens: 1000 + index * 50,
  outputTokens: 200 + index,
  cacheReadTokens: 400,
  cacheCreationTokens: 100,
  totalTokens: 1200 + index * 51,
  durationMs: 1200 + index * 25,
  timeToFirstTokenMs: 150,
  costUSD: index >= 50 ? 0.12 : null,
  costSource: index >= 50 ? "client-reported" : "estimated",
}));

function priced(log: AppUsageRequestLog): AppUsageRequestLog {
  const cost = createUsageCost(settings.entries);
  const nanos = cost(
    log.providerId,
    log.modelId,
    log.inputTokens,
    log.outputTokens,
    log.cacheReadTokens,
    log.cacheCreationTokens,
    true,
  );
  return {
    ...log,
    costUSD: nanos === null ? log.costUSD : Number(nanos) / 1e9,
    costSource: nanos === null ? log.costSource : "estimated",
  };
}
function aggregate(logs: AppUsageRequestLog[]): AppUsageMetrics {
  const metrics = baseMetrics();
  let cost = 0;
  let pricedCount = 0;
  for (const log of logs) {
    metrics.requestCount += 1;
    metrics.totalTokens += log.totalTokens;
    metrics.inputTokens += log.inputTokens;
    metrics.outputTokens += log.outputTokens;
    metrics.cacheReadTokens += log.cacheReadTokens;
    metrics.cacheCreationTokens += log.cacheCreationTokens;
    if (log.costUSD === null) metrics.unpricedCount += 1;
    else {
      cost += log.costUSD;
      pricedCount += 1;
    }
  }
  metrics.cacheHitRate = metrics.inputTokens ? metrics.cacheReadTokens / metrics.inputTokens : 0;
  metrics.costUSD = pricedCount ? cost : null;
  return metrics;
}
function grouped(logs: AppUsageRequestLog[], key: (log: AppUsageRequestLog) => string) {
  const groups = new Map<string, AppUsageRequestLog[]>();
  for (const log of logs) {
    const value = key(log);
    groups.set(value, [...(groups.get(value) ?? []), log]);
  }
  return [...groups].map(([id, entries]) => ({ id, ...aggregate(entries) }));
}

function snapshot(request: AppUsageRequest) {
  const query = request.dashboard;
  const until = Math.min(request.until ?? Date.now(), query?.until ?? Infinity);
  let since = request.since ?? 0;
  if (request.range === "today") {
    const start = new Date(until);
    start.setHours(0, 0, 0, 0);
    since = start.getTime();
  }
  if (["7d", "14d", "30d", "24h"].includes(request.range))
    since =
      until - (request.range === "24h" ? 1 : Number(request.range.replace("d", ""))) * 86_400_000;
  const scopeRecords = records.filter(
    (record) =>
      (query?.scope === "all-clients"
        ? !query.clientId || record.clientId === query.clientId
        : record.clientId === "shucode") &&
      record.startedAt >= since &&
      record.startedAt <= until,
  );
  const all = scopeRecords
    .filter(
      (record) =>
        (!query?.providerId || record.providerId === query.providerId) &&
        (!query?.modelId || record.modelId === query.modelId),
    )
    .map(priced);
  const logs = all.filter((log) => !query?.status || log.status === query.status);
  const page = query?.page ?? 0;
  const pageSize = query?.pageSize ?? 20;
  const visible = query?.after
    ? logs
        .filter(
          (log) =>
            log.startedAt < query.after!.startedAt ||
            (log.startedAt === query.after!.startedAt && log.id < query.after!.id),
        )
        .slice(0, pageSize)
    : logs.slice(page * pageSize, (page + 1) * pageSize);
  const tail = visible.at(-1);
  const hourly = request.range === "today" || request.range === "24h";
  const buckets = grouped(all, (log) =>
    hourly
      ? new Date(log.startedAt).toISOString().slice(0, 13) + ":00:00Z"
      : new Date(log.startedAt).toISOString().slice(0, 10),
  )
    .map(({ id, ...metrics }) => ({ bucket: id, ...metrics }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
  const dashboard: AppUsageDashboard = {
    summary: aggregate(all),
    providers: grouped(all, (log) => log.providerId ?? "").map(({ id, ...metrics }) => ({
      providerId: id,
      ...metrics,
    })),
    models: grouped(all, (log) => JSON.stringify([log.providerId, log.modelId])).map(
      ({ id, ...metrics }) => ({
        providerId: JSON.parse(id)[0],
        modelId: JSON.parse(id)[1],
        ...metrics,
      }),
    ),
    trend: buckets,
    heatmap: Array.from({ length: 371 }, (_, index) => ({
      ...aggregate(all),
      bucket: new Date(NOW - index * 86_400_000).toISOString().slice(0, 10),
      totalTokens: index % 7 ? 0 : 500 + index * 100,
      requestCount: index % 7 ? 0 : index + 1,
      costUSD: index % 5 ? null : index / 100,
    })),
    providerOptions: [...new Set(scopeRecords.map((log) => log.providerId!))],
    modelOptions: [...new Set(scopeRecords.map((log) => log.modelId!))],
    clientOptions: USAGE_CLIENT_IDS.map((id, index) => ({
      id,
      label: labels[index],
      available: index < 7,
      error: index >= 7 ? "Fixture source unavailable" : undefined,
    })),
    sourceErrors:
      query?.clientId === "dsh-desktop"
        ? [{ clientId: "dsh-desktop", message: "Fixture permission failure" }]
        : [],
    logs: visible,
    pagination: {
      page,
      pageSize,
      total: logs.length,
      until,
      nextCursor: tail ? { id: tail.id, startedAt: tail.startedAt } : undefined,
    },
  };
  return appUsageSnapshotSchema.parse({
    range: request.range,
    generatedAt: Date.now(),
    timeZone: request.timeZone ?? "UTC",
    source: "agent-db",
    dashboard,
    summary: {
      ...dashboard.summary,
      reasoningTokens: 0,
      totalSessions: 1,
      totalTurns: all.length,
      toolCallCount: 0,
      toolErrorRate: 0,
      modelErrorRate: 0,
      avgTimeToFirstTokenMs: 150,
      avgTurnDurationMs: 1200,
      activeDays: 1,
      currentStreakDays: 1,
      longestSessionMs: 3600000,
      longestStreakDays: 1,
      peakDayTokens: dashboard.summary.totalTokens,
      favoriteModel: null,
    },
    heatmap: { startDate: null, endDate: null, maxTokens: 0, weeks: [] },
    dailyModelUsage: [],
    models: [],
    tools: [],
  });
}

export const fixtureControls = {
  holdNext: () => {
    holdNext = true;
  },
  release: () => {
    held?.resolve();
    held = null;
  },
  pending: () => pendingCount,
  settings: () => structuredClone(settings),
  requests: [] as AppUsageRequest[],
  useLegacyImportCcSwitch: () => {
    legacyImportCcSwitch = true;
  },
};
export const usageStatsService: IUsageStatsService = {
  async getAppUsageSnapshot(request) {
    fixtureControls.requests.push(structuredClone(request));
    pendingCount += 1;
    const result = snapshot(request);
    try {
      if (holdNext) {
        holdNext = false;
        await new Promise<void>((resolve) => {
          held = { resolve, request };
        });
      }
      return result;
    } finally {
      pendingCount -= 1;
    }
  },
  async getPricing() {
    return structuredClone(settings);
  },
  async savePrice(price, previousKey) {
    settings.entries = settings.entries.filter(
      (entry) =>
        usagePriceKey(entry) !== usagePriceKey(price) && usagePriceKey(entry) !== previousKey,
    );
    settings.entries.push(price);
    return structuredClone(settings);
  },
  async deletePrice(key) {
    settings.entries = settings.entries.filter((entry) => usagePriceKey(entry) !== key);
    return structuredClone(settings);
  },
  async getModelsDevPrices() {
    return structuredClone(catalog);
  },
  async importModelsDevPrices(keys) {
    settings.modelsDevSelectedKeys = keys;
    for (const price of catalog.filter((entry) => keys.includes(entry.catalogKey!))) {
      if (!settings.entries.some((entry) => usagePriceKey(entry) === usagePriceKey(price)))
        settings.entries.push(price);
    }
    settings.lastSyncedAt = Date.now();
    return structuredClone(settings);
  },
  async setModelsDevAutoSync(enabled) {
    settings.modelsDevAutoSync = enabled;
    return structuredClone(settings);
  },
  async syncModelsDevPrices() {
    settings.lastSyncedAt = Date.now();
    return structuredClone(settings);
  },
  async importCcSwitchPrices(json) {
    if (legacyImportCcSwitch) {
      legacyImportCcSwitch = false;
      throw Object.assign(new Error("Method not found: importCcSwitchPrices"), { code: -32601 });
    }
    const data = JSON.parse(json) as {
      version: number;
      models?: {
        modelId: string;
        displayName?: string;
        inputCostPerMillion: string;
        outputCostPerMillion: string;
        cacheReadCostPerMillion?: string;
        cacheCreationCostPerMillion?: string;
      }[];
    };
    if (data.version !== 1 || !Array.isArray(data.models))
      throw new Error("Invalid CC Switch pricing fixture");
    const prices: UsageModelPrice[] = data.models.map((price) => ({
      modelId: price.modelId,
      displayName: price.displayName,
      inputUSD: Number(price.inputCostPerMillion),
      outputUSD: Number(price.outputCostPerMillion),
      cacheReadUSD:
        price.cacheReadCostPerMillion === undefined ? null : Number(price.cacheReadCostPerMillion),
      cacheWriteUSD:
        price.cacheCreationCostPerMillion === undefined
          ? null
          : Number(price.cacheCreationCostPerMillion),
      source: "manual",
    }));
    let imported = 0;
    let skipped = 0;
    for (const price of prices) {
      if (settings.entries.some((entry) => usagePriceKey(entry) === usagePriceKey(price)))
        skipped += 1;
      else {
        settings.entries.push(price);
        imported += 1;
      }
    }
    return { settings: structuredClone(settings), imported, skipped };
  },
};
