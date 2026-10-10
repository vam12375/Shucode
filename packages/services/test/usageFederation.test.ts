import assert from "node:assert/strict";
import test from "node:test";
import {
  appUsageDashboardQuerySchema,
  type AppUsageDashboard,
  type AppUsageMetrics,
  type AppUsageRequestLog,
} from "@shucode/shared";
import { mergeUsageDashboards } from "../src/usage-stats/external/merge.js";

const until = Date.parse("2026-10-10T08:00:00Z");
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
function log(id: string, time = until): AppUsageRequestLog {
  return {
    id,
    clientId: id.split(":")[0]!,
    startedAt: time,
    providerId: null,
    modelId: null,
    querySource: "fixture",
    status: "completed",
    retryCount: 0,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 2,
    durationMs: null,
    timeToFirstTokenMs: null,
    costUSD: null,
  };
}
function part(
  summary: AppUsageMetrics = empty,
  logs: AppUsageRequestLog[] = [],
): AppUsageDashboard {
  return {
    summary,
    providers: [],
    models: [],
    trend: [],
    heatmap: [],
    logs,
    providerOptions: [],
    modelOptions: [],
    clientOptions: [],
    sourceErrors: [],
    pagination: { page: 0, pageSize: 20, total: logs.length, until },
  };
}
const query = (pageSize = 20, page = 0) =>
  appUsageDashboardQuerySchema.parse({ scope: "all-clients", pageSize, page });

test("联邦指标按token加权缓存，已知费用小计与未知调用并存", () => {
  const first = {
    ...empty,
    requestCount: 2,
    inputTokens: 100,
    outputTokens: 10,
    totalTokens: 110,
    cacheReadTokens: 50,
    cacheHitRate: 0.5,
    costUSD: 0.1,
    unpricedCount: 1,
  };
  const second = {
    ...empty,
    requestCount: 3,
    inputTokens: 900,
    outputTokens: 90,
    totalTokens: 990,
    cacheReadTokens: 90,
    cacheHitRate: 0.1,
    costUSD: null,
    unpricedCount: 3,
  };
  const a = part(first);
  const b = part(second);
  a.providers = [{ providerId: null, ...first }];
  b.providers = [{ providerId: null, ...second }];
  a.models = [{ providerId: null, modelId: "same", ...first }];
  b.models = [{ providerId: "other", modelId: "same", ...second }];
  const result = mergeUsageDashboards([a, b], query());
  assert.equal(result.summary.cacheHitRate, 0.14);
  assert.equal(result.summary.costUSD, 0.1);
  assert.equal(result.summary.unpricedCount, 4);
  assert.equal(result.summary.requestCount, 5);
  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0]?.cacheHitRate, 0.14);
  assert.equal(result.models.length, 2);
  assert.equal(
    mergeUsageDashboards([part({ ...empty, costUSD: 0 }), part()], query()).summary.costUSD,
    0,
  );
  assert.equal(mergeUsageDashboards([part(), part()], query()).summary.costUSD, null);
});

test("跨客户端相同时间游标按opaque id确定顺序，连续页不重不漏", () => {
  const all = [
    [log("shucode:z"), log("shucode:a"), log("shucode:old", until - 1)],
    [log("pi:z"), log("codex:b"), log("claude-code:a")],
  ];
  const pageSize = 2;
  const seen: string[] = [];
  let after: { startedAt: number; id: string } | undefined;
  for (let page = 0; page < 3; page++) {
    const parts = all.map((source) => {
      const remaining = source.filter(
        (row) =>
          !after ||
          row.startedAt < after.startedAt ||
          (row.startedAt === after.startedAt && row.id < after.id),
      );
      const result = part(empty, remaining.slice(0, pageSize));
      result.pagination.total = source.length;
      if (remaining.length > pageSize) {
        const last = result.logs.at(-1)!;
        result.pagination.nextCursor = { startedAt: last.startedAt, id: last.id };
      }
      return result;
    });
    const result = mergeUsageDashboards(parts, query(pageSize, page));
    seen.push(...result.logs.map((row) => row.id));
    assert.equal(result.pagination.total, 6);
    after = result.pagination.nextCursor;
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
});

test("Unicode opaque id使用SQLite UTF-8 BINARY顺序", () => {
  const result = mergeUsageDashboards(
    [part(empty, [log("shucode:\ue000")]), part(empty, [log("shucode:\u{10000}")])],
    query(1),
  );
  assert.equal(result.logs[0]?.id, "shucode:\u{10000}");
  assert.deepEqual(result.pagination.nextCursor, {
    startedAt: until,
    id: "shucode:\u{10000}",
  });
});

test("DST小时按实际时间排序，选项/错误去重且不同snapshot拒绝合并", () => {
  const a = part();
  const b = part();
  a.trend = [{ bucket: "2026-11-01T01:00-05:00", ...empty }];
  b.trend = [{ bucket: "2026-11-01T01:00-04:00", ...empty }];
  a.providerOptions = ["a"];
  b.providerOptions = ["b", "a"];
  a.clientOptions = [{ id: "codex", label: "Codex", available: true }];
  b.clientOptions = [{ id: "codex", label: "Codex", available: false, error: "fixture" }];
  a.sourceErrors = [{ clientId: "codex", message: "fixture" }];
  b.sourceErrors = a.sourceErrors;
  const result = mergeUsageDashboards([a, b], query());
  assert.deepEqual(
    result.trend.map((row) => row.bucket),
    ["2026-11-01T01:00-04:00", "2026-11-01T01:00-05:00"],
  );
  assert.deepEqual(result.providerOptions, ["a", "b"]);
  assert.equal(result.clientOptions.length, 1);
  assert.equal(result.clientOptions[0]?.available, true);
  assert.equal(result.sourceErrors.length, 1);
  b.pagination.until++;
  assert.throws(() => mergeUsageDashboards([a, b], query()), /snapshot/);
});
