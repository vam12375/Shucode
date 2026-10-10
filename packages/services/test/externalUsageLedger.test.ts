import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { UsageModelPrice } from "@shucode/shared";
import { ExternalUsageLedger } from "../src/usage-stats/external/ledger.js";
import type { ExternalUsageRecord } from "../src/usage-stats/external/types.js";

const until = Date.parse("2026-10-10T08:00:00Z");
const price: UsageModelPrice = {
  modelId: "example-model",
  inputUSD: 2,
  outputUSD: 8,
  cacheReadUSD: 0.2,
  cacheWriteUSD: 3,
  source: "manual",
};
function record(id: string, overrides: Partial<ExternalUsageRecord> = {}): ExternalUsageRecord {
  return {
    id,
    clientId: "codex",
    startedAt: until - 1000,
    providerId: "provider-a",
    modelId: "example-model",
    querySource: "session-log",
    status: "completed",
    retryCount: 0,
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 600,
    cacheCreationTokens: 100,
    totalTokens: 1200,
    durationMs: null,
    timeToFirstTokenMs: null,
    hasUsage: true,
    ...overrides,
  };
}

test("外部账本合并幂等事实、明确客户端隔离，金额与token口径一致", () => {
  const ledger = new ExternalUsageLedger(":memory:");
  try {
    ledger.upsert([
      record("codex:a"),
      record("claude:b", { clientId: "claude-code", providerId: "provider-b" }),
    ]);
    ledger.upsert([record("codex:a")]);
    const all = ledger.query({
      range: "all",
      until,
      timeZone: "Asia/Shanghai",
      dashboard: { scope: "all-clients", prices: [price] },
    });
    assert.equal(all.summary.requestCount, 2);
    assert.equal(all.summary.totalTokens, 2400);
    assert.equal(all.summary.cacheHitRate, 0.6);
    assert.equal(all.summary.costUSD, 0.00524);
    assert.equal(all.models.length, 2);
    const filtered = ledger.query({
      range: "all",
      until,
      dashboard: {
        scope: "all-clients",
        clientId: "codex",
        providerId: "provider-a",
        prices: [price],
      },
    });
    assert.equal(filtered.summary.requestCount, 1);
    assert.equal(filtered.logs[0]?.clientId, "codex");
    assert.deepEqual(filtered.providerOptions, ["provider-a", "provider-b"]);
    assert.equal(
      ledger.query({
        range: "all",
        until,
        dashboard: { scope: "all-clients", clientId: "shucode" },
      }).summary.requestCount,
      0,
    );
  } finally {
    ledger.close();
  }
});

test("native费用仅在无匹配价格时兜底，已知零与未知分开", () => {
  const ledger = new ExternalUsageLedger(":memory:");
  try {
    ledger.upsert([
      record("native:a", { nativeCostUSD: 0.5 }),
      record("native:b", { nativeCostUSD: 0 }),
      record("unknown:c", {
        hasUsage: false,
        status: "cancelled",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      }),
    ]);
    const query = (prices: UsageModelPrice[] = []) =>
      ledger.query({
        range: "all",
        until,
        dashboard: { scope: "all-clients", status: "cancelled", prices },
      });
    assert.equal(query().summary.costUSD, 0.5);
    assert.equal(query().summary.unpricedCount, 1);
    assert.equal(query().logs.length, 1);
    assert.equal(query().logs[0]?.costUSD, null);
    assert.equal(query([price]).summary.costUSD, 0.00524);
    assert.equal(query([{ ...price, cacheReadUSD: null }]).summary.costUSD, null);
    assert.equal(query([{ ...price, cacheReadUSD: null }]).summary.unpricedCount, 3);
  } finally {
    ledger.close();
  }
});

test("指纹与长期用量持久化，固定until与cursor稳定翻页", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shucode-usage-ledger-"));
  const path = join(dir, "usage.sqlite");
  let ledger = new ExternalUsageLedger(path);
  try {
    ledger.upsert([
      record("codex:a"),
      record("codex:b"),
      record("codex:c"),
      record("old", { startedAt: Date.parse("1980-01-01T00:00:00Z") }),
    ]);
    ledger.setFileFingerprint("file-example", "fingerprint-example");
    ledger.close();
    ledger = new ExternalUsageLedger(path);
    assert.equal(ledger.getFileFingerprint("file-example"), "fingerprint-example");
    const first = ledger.query({
      range: "all",
      until,
      dashboard: { scope: "all-clients", pageSize: 2 },
    });
    assert.deepEqual(
      first.logs.map((row) => row.id),
      ["codex:c", "codex:b"],
    );
    assert.equal(first.summary.requestCount, 4);
    assert.ok(first.trend.length <= 371);
    ledger.upsert([record("new", { startedAt: until + 1 })]);
    const next = ledger.query({
      range: "all",
      until,
      dashboard: { scope: "all-clients", after: first.pagination.nextCursor, pageSize: 2 },
    });
    assert.deepEqual(
      next.logs.map((row) => row.id),
      ["codex:a", "old"],
    );
    assert.equal(next.pagination.total, 4);
  } finally {
    ledger.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("null模型/供应商保持null，DST小时与日热图一致", () => {
  const ledger = new ExternalUsageLedger(":memory:");
  try {
    const timestamp = Date.parse("2026-11-01T07:00:00Z");
    ledger.upsert([
      record("first", {
        startedAt: Date.parse("2026-11-01T05:30:00Z"),
        providerId: null,
        modelId: null,
      }),
      record("second", {
        startedAt: Date.parse("2026-11-01T06:30:00Z"),
        providerId: null,
        modelId: null,
      }),
    ]);
    const result = ledger.query({
      range: "today",
      until: timestamp,
      timeZone: "America/New_York",
      dashboard: { scope: "all-clients" },
    });
    assert.equal(result.logs[0]?.providerId, null);
    assert.equal(result.models[0]?.modelId, null);
    assert.deepEqual(result.providerOptions, []);
    assert.equal(result.heatmap[0]?.requestCount, 2);
    const active = result.trend.filter((item) => item.requestCount > 0);
    assert.deepEqual(
      active.map((item) => item.bucket),
      ["2026-11-01T01:00-04:00", "2026-11-01T01:00-05:00"],
    );
  } finally {
    ledger.close();
  }
});

test("单文件导入事务失败不提交指纹或半批用量", () => {
  const ledger = new ExternalUsageLedger(":memory:");
  try {
    ledger.commitFile("file-example", "old-fingerprint", [record("codex:existing")]);
    assert.throws(() =>
      ledger.commitFile("file-example", "new-fingerprint", [
        record("codex:half-batch"),
        record("codex:invalid", { clientId: undefined as never }),
      ]),
    );
    assert.equal(ledger.getFileFingerprint("file-example"), "old-fingerprint");
    const result = ledger.query({ range: "all", until, dashboard: { scope: "all-clients" } });
    assert.equal(result.summary.requestCount, 1);
    assert.equal(result.logs[0]?.id, "codex:existing");
  } finally {
    ledger.close();
  }
});

test("流式stage批次在文件成功前不可见，失败可回退重扫", () => {
  const ledger = new ExternalUsageLedger(":memory:");
  const query = () => ledger.query({ range: "all", until, dashboard: { scope: "all-clients" } });
  try {
    ledger.beginFileScan();
    ledger.stageFileRecords([record("codex:first")]);
    ledger.stageFileRecords([record("codex:second")]);
    assert.equal(query().summary.requestCount, 0);
    assert.equal(ledger.hasClientData("codex"), false);
    ledger.abortFileScan();
    assert.equal(ledger.getFileFingerprint("file-example"), undefined);
    ledger.beginFileScan();
    ledger.stageFileRecords([record("codex:first"), record("codex:second")]);
    ledger.commitFileScan("file-example", "complete");
    assert.equal(query().summary.requestCount, 2);
    assert.equal(ledger.hasClientData("codex"), true);
    assert.equal(ledger.getFileFingerprint("file-example"), "complete");
    ledger.beginFileScan();
    ledger.stageFileRecords([record("codex:new")]);
    assert.throws(() =>
      ledger.stageFileRecords([record("codex:invalid", { clientId: undefined as never })]),
    );
    ledger.abortFileScan();
    assert.equal(query().summary.requestCount, 2);
    assert.equal(ledger.getFileFingerprint("file-example"), "complete");
  } finally {
    ledger.close();
  }
});

test("跨文件同一请求不会被较新的partial快照覆盖，终态同级允许更新缓存路由", () => {
  const ledger = new ExternalUsageLedger(":memory:");
  try {
    ledger.upsert([
      record("claude:message", {
        clientId: "claude-code",
        status: "completed",
        outputTokens: 100,
        providerId: "old-provider",
        cacheReadTokens: 4,
      }),
    ]);
    ledger.upsert([
      record("claude:message", {
        clientId: "claude-code",
        status: "unknown",
        outputTokens: 1,
        providerId: "partial-provider",
        cacheReadTokens: 99,
      }),
    ]);
    let result = ledger.query({ range: "all", until, dashboard: { scope: "all-clients" } });
    assert.equal(result.logs[0]?.status, "completed");
    assert.equal(result.logs[0]?.outputTokens, 100);
    assert.equal(result.logs[0]?.providerId, "old-provider");
    ledger.upsert([
      record("claude:message", {
        clientId: "claude-code",
        status: "completed",
        outputTokens: 100,
        providerId: "new-provider",
        cacheReadTokens: 8,
      }),
    ]);
    result = ledger.query({ range: "all", until, dashboard: { scope: "all-clients" } });
    assert.equal(result.logs[0]?.providerId, "new-provider");
    assert.equal(result.logs[0]?.cacheReadTokens, 8);
    ledger.upsert([
      record("claude:message", {
        clientId: "claude-code",
        status: "completed",
        outputTokens: 50,
        providerId: "stale-provider",
      }),
    ]);
    assert.equal(
      ledger.query({ range: "all", until, dashboard: { scope: "all-clients" } }).logs[0]
        ?.providerId,
      "new-provider",
    );
  } finally {
    ledger.close();
  }
});
