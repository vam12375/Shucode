import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { UsageModelPrice } from "@shucode/shared";
import { SQLITE_MIGRATIONS } from "../src/storage/session-store/migrations.js";
import { runSqliteSessionMigrations } from "../src/storage/session-store/migration-runner.js";
import { queryAppUsageDashboard } from "../src/storage/session-store/repositories/usage-dashboard.js";
import {
  isHourlyDashboard,
  resolveDashboardRange,
  usageBucket,
} from "../src/storage/session-store/repositories/usage-time.js";
import {
  recordModelUsage,
  upsertTurnUsage,
  upsertToolUsage,
  pruneUsage,
} from "../src/storage/session-store/repositories/usage.js";

const now = Date.parse("2026-10-10T08:00:00Z");
const price: UsageModelPrice = {
  modelId: "example-model",
  inputUSD: 2,
  outputUSD: 8,
  cacheReadUSD: 0.2,
  cacheWriteUSD: 3,
  source: "manual",
};

function openDb(legacy = false): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  if (legacy) {
    db.exec(
      "pragma foreign_keys=on; create table schema_migration(id text primary key, checksum text not null, app_version text, time_applied integer not null)",
    );
    db.exec("begin immediate");
    for (const migration of SQLITE_MIGRATIONS.filter((entry) => entry.id < "0023")) {
      db.exec(migration.sql);
      db.prepare("insert into schema_migration values(?,?,?,?)").run(
        migration.id,
        createHash("sha256").update(migration.sql.trim()).digest("hex"),
        migration.appVersion,
        now,
      );
    }
    db.exec("commit");
  } else runSqliteSessionMigrations(db, ":memory:");
  db.prepare(
    "insert into session(id,project_id,slug,directory,title,version,time_created,time_updated) values(?,?,?,?,?,?,?,?)",
  ).run("session-example", "project-example", "example", "/example", "Example", "1", now, now);
  return db;
}

async function write(db: DatabaseSync, id: string, overrides: Record<string, unknown> = {}) {
  await recordModelUsage(db, {
    id,
    logicalRequestId: id,
    sessionID: "session-example" as never,
    querySource: "main_turn",
    providerId: "provider-a",
    modelId: "example-model",
    status: "completed",
    startedAt: now - 1000,
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadInputTokens: 600,
    cacheCreationInputTokens: 100,
    reasoningTokens: 50,
    rawUsage: { inputTokens: 1000, outputTokens: 200 },
    ...overrides,
  });
}

function query(db: DatabaseSync, overrides: Record<string, unknown> = {}) {
  return queryAppUsageDashboard(db, {
    range: "all",
    timeZone: "Asia/Shanghai",
    until: now,
    query: { scope: "shucode", page: 0, pageSize: 20, prices: [price], ...overrides },
  });
}

test("缓存与推理不重复相加，模型供应商独立计价", async () => {
  const db = openDb();
  try {
    await write(db, "one");
    await write(db, "two", { providerId: "provider-b" });
    const result = await query(db, {
      prices: [price, { ...price, providerId: "provider-b", inputUSD: 4 }],
    });
    assert.equal(result.summary.totalTokens, 2400);
    assert.equal(result.summary.cacheHitRate, 0.6);
    assert.equal(result.logs.find((row) => row.providerId === "provider-a")?.costUSD, 0.00262);
    assert.equal(result.logs.find((row) => row.providerId === "provider-b")?.costUSD, 0.00322);
    assert.equal(result.models.length, 2);
    assert.equal(result.summary.costUSD, 0.00584);
    const filtered = await query(db, { providerId: "provider-a" });
    assert.equal(filtered.summary.requestCount, 1);
    assert.deepEqual(filtered.providerOptions, ["provider-a", "provider-b"]);
  } finally {
    db.close();
  }
});

test("已知零价格与未知用量分开，状态只筛选日志", async () => {
  const db = openDb();
  try {
    await write(db, "known-zero", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      rawUsage: { inputTokens: 0, outputTokens: 0 },
    });
    await write(db, "cancelled", {
      status: "cancelled",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      rawUsage: undefined,
    });
    await write(db, "error", {
      status: "error",
      rawUsage: undefined,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    const result = await query(db, {
      status: "cancelled",
      prices: [{ ...price, inputUSD: 0, outputUSD: 0 }],
    });
    assert.equal(result.summary.requestCount, 3);
    assert.equal(result.summary.unpricedCount, 2);
    assert.equal(result.summary.costUSD, 0);
    assert.equal(result.logs.length, 1);
    assert.equal(result.logs[0]?.costUSD, null);
    assert.equal(result.pagination.total, 1);
    const missingCache = await query(db, { prices: [{ ...price, cacheReadUSD: null }] });
    assert.equal(missingCache.logs.find((row) => row.id === "shucode:known-zero")?.costUSD, 0);
    await write(db, "missing-price");
    assert.equal((await query(db, { prices: [] })).summary.costUSD, null);
    assert.equal(
      (await query(db, { prices: [{ ...price, cacheReadUSD: null }] })).summary.unpricedCount,
      3,
    );
  } finally {
    db.close();
  }
});

test("稳定分页、幂等写入与纳美元逐行取整", async () => {
  const db = openDb();
  try {
    for (const id of ["a", "b", "c"]) await write(db, id);
    await write(db, "a");
    const first = await query(db, { pageSize: 2 });
    assert.deepEqual(
      first.logs.map((row) => row.id),
      ["shucode:c", "shucode:b"],
    );
    await write(db, "new", { startedAt: now + 1 });
    const next = await query(db, { page: 1, pageSize: 2, until: first.pagination.until });
    assert.deepEqual(
      next.logs.map((row) => row.id),
      ["shucode:a"],
    );
    assert.equal(next.pagination.total, 3);
    const cursorNext = await query(db, {
      pageSize: 2,
      after: first.pagination.nextCursor,
      until: first.pagination.until,
    });
    assert.deepEqual(
      cursorNext.logs.map((row) => row.id),
      ["shucode:a"],
    );
    assert.equal(cursorNext.logs[0]?.clientId, "shucode");
    assert.equal(cursorNext.pagination.nextCursor, undefined);
    const tiny = await query(db, {
      prices: [{ ...price, inputUSD: 0.000001, outputUSD: 0, cacheReadUSD: 0, cacheWriteUSD: 0 }],
    });
    assert.equal(tiny.summary.costUSD, 0);
  } finally {
    db.close();
  }
});

test("长期历史不再自动清理，显式清理必须提供时间", async () => {
  const db = openDb();
  try {
    await write(db, "old", { startedAt: Date.now() - 100 * 86_400_000 });
    await write(db, "new", { startedAt: Date.now() });
    assert.equal(db.prepare("select count(*) n from model_usage").get()?.n, 2);
    await assert.rejects(() => pruneUsage(db, undefined as never));
    await pruneUsage(db, { beforeTime: 1 });
    assert.equal(db.prepare("select count(*) n from model_usage").get()?.n, 2);
  } finally {
    db.close();
  }
});

test("升级保留三张用量表的全部记录/索引/约束，删除聊天不删除历史", async () => {
  const db = openDb(true);
  try {
    await write(db, "one", { errorCode: "example", providerMetadata: { example: true } });
    await upsertTurnUsage(db, {
      sessionID: "session-example" as never,
      turnID: "turn-example" as never,
      status: "completed",
      startedAt: now,
    });
    await upsertToolUsage(db, {
      id: "tool-example",
      sessionID: "session-example" as never,
      toolCallID: "call-example",
      toolName: "example",
      status: "completed",
      startedAt: now,
    });
    const tables = ["model_usage", "turn_usage", "tool_usage"];
    const before = tables.map((name) => db.prepare(`select * from ${name}`).all());
    const indexes = tables.map((name) =>
      db
        .prepare(`pragma index_list(${name})`)
        .all()
        .map((row) => row.name)
        .sort(),
    );
    runSqliteSessionMigrations(db, ":memory:");
    assert.deepEqual(
      tables.map((name) => db.prepare(`select * from ${name}`).all()),
      before,
    );
    assert.deepEqual(
      tables.map((name) =>
        db
          .prepare(`pragma index_list(${name})`)
          .all()
          .map((row) => row.name)
          .sort(),
      ),
      indexes,
    );
    db.prepare("delete from session where id=?").run("session-example");
    assert.deepEqual(
      tables.map((name) => db.prepare(`select count(*) n from ${name}`).get()?.n),
      [1, 1, 1],
    );
    assert.equal(db.prepare("pragma foreign_key_check").all().length, 0);
    await write(db, "after-delete");
    assert.equal((await query(db)).summary.requestCount, 2);
    runSqliteSessionMigrations(db, ":memory:");
  } finally {
    db.close();
  }
});

test("自然日与 DST 正确归桶并区分重复小时", async () => {
  const spring = resolveDashboardRange(
    "today",
    "America/New_York",
    Date.parse("2026-03-08T20:00:00Z"),
  );
  assert.equal(spring.since, Date.parse("2026-03-08T05:00:00Z"));
  const autumn = resolveDashboardRange(
    "today",
    "America/New_York",
    Date.parse("2026-11-01T20:00:00Z"),
  );
  assert.equal(autumn.since, Date.parse("2026-11-01T04:00:00Z"));
  assert.equal(
    usageBucket(Date.parse("2026-11-01T05:30:00Z"), "America/New_York", true),
    "2026-11-01T01:00-04:00",
  );
  assert.equal(
    usageBucket(Date.parse("2026-11-01T06:30:00Z"), "America/New_York", true),
    "2026-11-01T01:00-05:00",
  );
  assert.equal(
    resolveDashboardRange("7d", "Asia/Shanghai", now).since,
    Date.parse("2026-10-03T16:00:00Z"),
  );
  assert.equal(
    usageBucket(Date.parse("2026-03-08T04:59:59Z"), "America/New_York", false),
    "2026-03-07",
  );
  assert.equal(
    resolveDashboardRange("14d", "Asia/Shanghai", now).since,
    Date.parse("2026-09-26T16:00:00Z"),
  );
  assert.equal(resolveDashboardRange("24h", "Asia/Shanghai", now).since, now - 86_400_000);
  assert.deepEqual(resolveDashboardRange("custom", "UTC", now, now - 1000), {
    since: now - 1000,
    until: now,
  });
  assert.throws(() => resolveDashboardRange("custom", "UTC", now, now + 1));
  assert.equal(isHourlyDashboard("custom", now - 86_400_000, now), true);
  assert.equal(isHourlyDashboard("custom", now - 86_400_001, now), false);
});

test("自然日范围内的heatmap和小时趋势使用相同事实源", async () => {
  const db = openDb();
  try {
    await write(db, "before-midnight", { startedAt: Date.parse("2026-10-09T15:59:59Z") });
    await write(db, "at-midnight", { startedAt: Date.parse("2026-10-09T16:00:00Z") });
    const result = await queryAppUsageDashboard(db, {
      range: "today",
      timeZone: "Asia/Shanghai",
      until: now,
      query: { scope: "shucode", page: 0, pageSize: 20, prices: [price] },
    });
    assert.equal(result.summary.requestCount, 1);
    assert.equal(result.heatmap[0]?.requestCount, 1);
    assert.equal(result.heatmap[0]?.bucket, "2026-10-10");
    assert.equal(result.trend[0]?.bucket, "2026-10-10T00:00+08:00");
    assert.equal(result.trend[0]?.requestCount, 1);
  } finally {
    db.close();
  }
});

test("价格优先级、缺缓存单价与已知零价", async () => {
  const db = openDb();
  try {
    await write(db, "example");
    const imported = {
      ...price,
      providerId: "provider-a",
      source: "models-dev" as const,
      inputUSD: 100,
    };
    assert.equal((await query(db, { prices: [imported, price] })).summary.costUSD, 0.00262);
    const exact = {
      ...price,
      providerId: "provider-a",
      inputUSD: 0,
      outputUSD: 0,
      cacheReadUSD: 0,
      cacheWriteUSD: 0,
    };
    assert.equal((await query(db, { prices: [exact, imported, price] })).summary.costUSD, 0);
    const missingCache = await query(db, { prices: [{ ...price, cacheWriteUSD: null }] });
    assert.equal(missingCache.summary.costUSD, null);
    assert.equal(missingCache.summary.unpricedCount, 1);
    const otherProvider = await query(db, { prices: [{ ...imported, providerId: "provider-b" }] });
    assert.equal(otherProvider.summary.unpricedCount, 1);
  } finally {
    db.close();
  }
});

test("累计摘要保留远期历史，图表最多53周", async () => {
  const db = openDb();
  try {
    await write(db, "historical", { startedAt: Date.parse("1980-01-01T00:00:00Z") });
    await write(db, "within-year", { startedAt: now - 300 * 86_400_000 });
    const result = await query(db);
    assert.equal(result.summary.requestCount, 2);
    assert.ok(result.heatmap.length <= 371);
    assert.ok(result.trend.length <= 371);
    assert.equal(
      result.trend.reduce((sum, row) => sum + row.requestCount, 0),
      1,
    );
  } finally {
    db.close();
  }
});
