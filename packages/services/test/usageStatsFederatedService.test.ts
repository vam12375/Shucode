import assert from "node:assert/strict";
import test from "node:test";
import {
  appUsageDashboardQuerySchema,
  usagePricingSettingsSchema,
  type AppSettings,
  type AppUsageDashboard,
  type AppUsageRequest,
  type AppUsageRequestLog,
  type AppUsageSnapshot,
  type UsageModelPrice,
} from "@shucode/shared";
import { createUsageStatsService } from "../src/usage-stats/usageStatsService.js";
import { emptyUsageSnapshot } from "../src/usage-stats/usageSnapshot.js";

const until = Date.parse("2026-01-01T10:00:00Z");
const price: UsageModelPrice = {
  providerId: "fixture-provider",
  modelId: "fixture-model",
  source: "manual",
  inputUSD: 1,
  outputUSD: 2,
  cacheReadUSD: null,
  cacheWriteUSD: null,
};
const log = (id: string, startedAt = until): AppUsageRequestLog => ({
  id,
  clientId: id.split(":")[0]!,
  startedAt,
  providerId: "fixture-provider",
  modelId: "fixture-model",
  querySource: "fixture",
  status: "completed",
  retryCount: 0,
  inputTokens: 10,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 12,
  durationMs: null,
  timeToFirstTokenMs: null,
  costUSD: null,
});

function source(request: AppUsageRequest, rows: AppUsageRequestLog[]): AppUsageDashboard {
  const query = appUsageDashboardQuerySchema.parse(request.dashboard);
  const bound = request.until ?? query.until ?? until;
  const all = rows.filter((row) => row.startedAt <= bound);
  const after = query.after;
  const remaining = all.filter(
    (row) =>
      !after ||
      row.startedAt < after.startedAt ||
      (row.startedAt === after.startedAt &&
        Buffer.compare(Buffer.from(row.id), Buffer.from(after.id)) < 0),
  );
  const logs = remaining.slice(0, query.pageSize);
  const result = emptyUsageSnapshot(request, bound).dashboard!;
  result.summary = {
    ...result.summary,
    requestCount: all.length,
    totalTokens: all.length * 12,
    inputTokens: all.length * 10,
    outputTokens: all.length * 2,
    unpricedCount: all.length,
  };
  result.logs = logs;
  result.pagination.total = all.length;
  if (remaining.length > logs.length) {
    const last = logs.at(-1)!;
    result.pagination.nextCursor = { startedAt: last.startedAt, id: last.id };
  }
  return result;
}

function fixture(
  options: {
    localRows?: AppUsageRequestLog[];
    externalRows?: AppUsageRequestLog[];
    local?: (request: AppUsageRequest) => Promise<AppUsageSnapshot>;
    external?: (request: AppUsageRequest) => Promise<AppUsageDashboard>;
  } = {},
) {
  const localRequests: AppUsageRequest[] = [];
  const externalRequests: AppUsageRequest[] = [];
  const settings = {
    usagePricing: usagePricingSettingsSchema.parse({ entries: [price] }),
  } as AppSettings;
  const service = createUsageStatsService({
    settingService: {
      async get() {
        return settings;
      },
      async update() {},
    },
    apiClient: {
      async request() {
        throw new Error("Unexpected network");
      },
    },
    shucodeAgentService: {
      async getAppUsageStats(request) {
        localRequests.push(request);
        return options.local
          ? options.local(request)
          : {
              ...emptyUsageSnapshot(request, request.until ?? until),
              source: "agent-db",
              dashboard: source(request, options.localRows ?? [log("shucode:one")]),
            };
      },
    },
    externalUsageService: {
      async getDashboard(request) {
        externalRequests.push(request);
        return options.external
          ? options.external(request)
          : source(request, options.externalRows ?? [log("pi:one")]);
      },
      async dispose() {},
    },
  });
  return { service, localRequests, externalRequests };
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("federated requests share fixed snapshot bounds, custom range and owner pricing", async () => {
  const f = fixture();
  try {
    const result = await f.service.getAppUsageSnapshot({
      range: "custom",
      since: until - 1000,
      until,
      timeZone: "Asia/Shanghai",
      dashboard: { scope: "all-clients", until: until + 1000, prices: [], syncSources: true },
    });
    assert.equal(result.source, "federated");
    assert.equal(result.dashboard?.summary.requestCount, 2);
    assert.equal(result.dashboard?.pagination.until, until);
    assert.deepEqual(f.localRequests, f.externalRequests);
    assert.equal(f.localRequests[0]?.since, until - 1000);
    assert.equal(f.localRequests[0]?.timeZone, "Asia/Shanghai");
    assert.deepEqual(f.localRequests[0]?.dashboard?.prices, [price]);
    assert.equal(f.localRequests[0]?.dashboard?.until, until);
    assert.equal(f.localRequests[0]?.dashboard?.syncSources, true);
  } finally {
    await f.service.disposeAllAndWait();
  }
});

test("external client filters skip Agent queries and noncursor pages are rejected", async () => {
  const f = fixture();
  try {
    const result = await f.service.getAppUsageSnapshot({
      range: "all",
      until,
      dashboard: { scope: "all-clients", clientId: "pi" },
    });
    assert.equal(f.localRequests.length, 0);
    assert.equal(f.externalRequests[0]?.dashboard?.clientId, "pi");
    assert.equal(result.dashboard?.summary.requestCount, 1);
    await assert.rejects(
      f.service.getAppUsageSnapshot({ range: "all", dashboard: { scope: "all-clients", page: 1 } }),
      /requires a cursor/,
    );
    assert.equal(f.externalRequests.length, 1);
  } finally {
    await f.service.disposeAllAndWait();
  }
});

test("federated cursors page interleaved clients without applying source offsets", async () => {
  const f = fixture({
    localRows: [log("shucode:z"), log("shucode:a"), log("shucode:old", until - 1)],
    externalRows: [log("pi:z"), log("codex:b"), log("claude-code:a")],
  });
  try {
    let after: { startedAt: number; id: string } | undefined;
    const seen: string[] = [];
    for (let page = 0; page < 3; page++) {
      const result = await f.service.getAppUsageSnapshot({
        range: "all",
        until,
        dashboard: { scope: "all-clients", pageSize: 2, page, after },
      });
      assert.equal(result.dashboard?.pagination.page, page);
      assert.equal(result.dashboard?.pagination.total, 6);
      seen.push(...result.dashboard!.logs.map((row) => row.id));
      after = result.dashboard?.pagination.nextCursor;
    }
    assert.deepEqual(seen, [
      "shucode:z",
      "shucode:a",
      "pi:z",
      "codex:b",
      "claude-code:a",
      "shucode:old",
    ]);
    assert.equal(after, undefined);
    assert.ok(
      [...f.localRequests, ...f.externalRequests].every((request) => request.dashboard?.page === 0),
    );
    assert.deepEqual(f.localRequests[1]?.dashboard?.after, { startedAt: until, id: "shucode:a" });
  } finally {
    await f.service.disposeAllAndWait();
  }
});

test("partial source failures retain other metrics and identify the failed source", async () => {
  const localFailure = fixture({
    local: async () => {
      throw new Error("fixture local unavailable");
    },
  });
  const externalFailure = fixture({
    external: async () => {
      throw new Error("fixture external unavailable");
    },
  });
  try {
    const request: AppUsageRequest = { range: "all", until, dashboard: { scope: "all-clients" } };
    const local = await localFailure.service.getAppUsageSnapshot(request);
    assert.equal(local.dashboard?.summary.requestCount, 1);
    assert.equal(local.dashboard?.sourceErrors[0]?.clientId, "shucode");
    assert.equal(
      local.dashboard?.clientOptions.find((client) => client.id === "shucode")?.available,
      false,
    );
    const external = await externalFailure.service.getAppUsageSnapshot(request);
    assert.equal(external.dashboard?.summary.requestCount, 1);
    assert.equal(external.dashboard?.sourceErrors[0]?.clientId, "external");
  } finally {
    await Promise.all([
      localFailure.service.disposeAllAndWait(),
      externalFailure.service.disposeAllAndWait(),
    ]);
  }
});

test("early external rejection is handled while Agent query awaits and disposal rejects stale completion", async () => {
  const started = gate<AppUsageRequest>();
  const pending = gate<AppUsageSnapshot>();
  const f = fixture({
    local: async (request) => {
      started.resolve(request);
      return pending.promise;
    },
    external: async () => {
      throw new Error("fixture early rejection");
    },
  });
  const query = f.service.getAppUsageSnapshot({
    range: "all",
    until,
    dashboard: { scope: "all-clients" },
  });
  const rejected = assert.rejects(query, /disposed/);
  const request = await started.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  await f.service.disposeAllAndWait();
  pending.resolve(emptyUsageSnapshot(request, until));
  await rejected;
  await assert.rejects(f.service.getAppUsageSnapshot({ range: "all" }), /disposed/);
});

test("future requested until is clamped once before both sources query", async () => {
  const f = fixture();
  try {
    const before = Date.now();
    const result = await f.service.getAppUsageSnapshot({
      range: "all",
      until: before + 60_000,
      dashboard: { scope: "all-clients" },
    });
    const boundary = result.dashboard!.pagination.until;
    assert.ok(boundary >= before && boundary <= Date.now());
    assert.equal(f.localRequests[0]?.until, boundary);
    assert.equal(f.externalRequests[0]?.until, boundary);
  } finally {
    await f.service.disposeAllAndWait();
  }
});

test("custom until cannot replace the earlier fixed pagination snapshot", async () => {
  const f = fixture();
  try {
    const result = await f.service.getAppUsageSnapshot({
      range: "custom",
      since: until - 1000,
      until: until + 60_000,
      dashboard: { scope: "all-clients", until },
    });
    assert.equal(result.dashboard?.pagination.until, until);
    assert.equal(f.localRequests[0]?.until, until);
    assert.equal(f.externalRequests[0]?.until, until);
  } finally {
    await f.service.disposeAllAndWait();
  }
});
