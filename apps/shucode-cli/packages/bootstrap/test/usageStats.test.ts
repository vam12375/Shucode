import assert from "node:assert/strict";
import test from "node:test";
import { appUsageSnapshotSchema } from "@shucode/shared";
import { getUsageStats } from "../src/shucode-protocol/server-usage.js";
import type { ShucodeProtocolAgentServerContext } from "../src/shucode-protocol/server-types.js";

const empty = {
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
  turnTotals: { totalSessions: 0, totalTurns: 0, avgTurnDurationMs: null, longestSessionMs: 0 },
  toolTotals: { toolCallCount: 0, toolErrorCount: 0 },
  models: [],
  tools: [],
  days: [],
  dayModels: [],
};
const metrics = {
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

test("旧统计载荷保持兼容，dashboard只读参数贯穿到store", async () => {
  const inputs: unknown[] = [];
  const context = {
    deps: {
      sessionStore: {
        queryAppUsage: async () => empty,
        queryAppUsageDashboard: async (input: unknown) => {
          inputs.push(input);
          return {
            summary: metrics,
            providers: [],
            models: [],
            trend: [],
            heatmap: [],
            clientOptions: [],
            sourceErrors: [],
            providerOptions: [],
            modelOptions: [],
            logs: [],
            pagination: { page: 0, pageSize: 20, total: 0, until: 1000 },
          };
        },
      },
    },
  } as unknown as ShucodeProtocolAgentServerContext;
  const legacy = await getUsageStats(context, { range: "7d", timeZone: "UTC" });
  assert.equal(legacy.dashboard, undefined);
  appUsageSnapshotSchema.parse(legacy);
  const result = await getUsageStats(context, {
    range: "custom",
    timeZone: "UTC",
    since: 0,
    until: 1000,
    dashboard: { providerId: "provider-example", after: { startedAt: 900, id: "example" } },
  });
  appUsageSnapshotSchema.parse(result);
  assert.deepEqual(inputs, [
    {
      range: "custom",
      timeZone: "UTC",
      since: 0,
      until: 1000,
      query: {
        scope: "shucode",
        providerId: "provider-example",
        page: 0,
        pageSize: 20,
        prices: [],
        after: { startedAt: 900, id: "example" },
      },
    },
  ]);
});

test("非法时区、倒置或缺失自定义范围在协议边界拒绝", async () => {
  const context = { deps: {} } as unknown as ShucodeProtocolAgentServerContext;
  for (const params of [
    { range: "custom", since: 100, until: 99 },
    { range: "custom" },
    { range: "today", timeZone: "Example/Invalid" },
  ])
    await assert.rejects(
      () => getUsageStats(context, params),
      (error: { code?: number }) => error.code === -32602,
    );
  await assert.rejects(
    () => getUsageStats(context, { range: "all", dashboard: {} }),
    /Usage dashboard store is unavailable/,
  );
});
