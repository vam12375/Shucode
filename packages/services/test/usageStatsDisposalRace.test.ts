import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettings, AppUsageSnapshot } from "@shucode/shared";
import { createUsageStatsService } from "../src/usage-stats/usageStatsService.js";

test("pricing read resumed after disposal cannot start external or Agent queries", async () => {
  let resolvePricing!: (settings: AppSettings) => void;
  const pricing = new Promise<AppSettings>((resolve) => {
    resolvePricing = resolve;
  });
  let externalCalls = 0;
  let agentCalls = 0;
  const service = createUsageStatsService({
    settingService: { get: () => pricing, async update() {} },
    apiClient: {
      async request() {
        throw new Error("Unexpected network");
      },
    },
    shucodeAgentService: {
      async getAppUsageStats() {
        agentCalls++;
        return {} as AppUsageSnapshot;
      },
    },
    externalUsageService: {
      async getDashboard() {
        externalCalls++;
        throw new Error("External should remain unused");
      },
      async dispose() {},
    },
  });
  const query = service.getAppUsageSnapshot({ range: "all", dashboard: { scope: "all-clients" } });
  await service.disposeAllAndWait();
  resolvePricing({} as AppSettings);
  await assert.rejects(query, /disposed/);
  assert.equal(externalCalls, 0);
  assert.equal(agentCalls, 0);
});
