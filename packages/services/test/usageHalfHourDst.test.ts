import assert from "node:assert/strict";
import test from "node:test";
import { dashboardBuckets } from "@shucode/shared";
import { ExternalUsageLedger } from "../src/usage-stats/external/ledger.js";
import type { ExternalUsageRecord } from "../src/usage-stats/external/types.js";

const since = Date.parse("2026-04-05T00:45:00+11:00");
const until = Date.parse("2026-04-05T03:15:00+10:30");
const usedAt = Date.parse("2026-04-05T01:45:00+10:30");

test("half-hour DST rollback includes both one-o'clock buckets in actual time order", () => {
  assert.deepEqual(dashboardBuckets(since, until, "Australia/Lord_Howe", true), [
    "2026-04-05T00:00+11:00",
    "2026-04-05T01:00+11:00",
    "2026-04-05T01:00+10:30",
    "2026-04-05T02:00+10:30",
    "2026-04-05T03:00+10:30",
  ]);
});

test("external SQL trend retains actual usage in the short DST rollback bucket", () => {
  const record: ExternalUsageRecord = {
    id: "pi:fixture",
    clientId: "pi",
    startedAt: usedAt,
    providerId: null,
    modelId: "fixture",
    querySource: "external-session",
    status: "unknown",
    retryCount: 0,
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 12,
    durationMs: null,
    timeToFirstTokenMs: null,
    hasUsage: true,
  };
  const ledger = new ExternalUsageLedger(":memory:");
  try {
    ledger.upsert([record]);
    const result = ledger.query({
      range: "custom",
      since,
      until,
      timeZone: "Australia/Lord_Howe",
      dashboard: { scope: "all-clients" },
    });
    assert.equal(result.summary.totalTokens, 12);
    assert.equal(
      result.trend.reduce((sum, point) => sum + point.totalTokens, 0),
      12,
    );
    assert.equal(
      result.trend.find((point) => point.bucket === "2026-04-05T01:00+10:30")?.totalTokens,
      12,
    );
  } finally {
    ledger.close();
  }
});
