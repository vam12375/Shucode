import assert from "node:assert/strict";
import test from "node:test";
import {
  usagePriceKey,
  usagePricingSettingsSchema,
  type AppSettings,
  type AppUsageRequest,
  type AppUsageSnapshot,
  type UsageModelPrice,
  type UsagePricingSettings,
} from "@shucode/shared";
import { createUsageStatsService } from "../src/usage-stats/usageStatsService.js";

const catalog = {
  vendor: {
    models: {
      "model-a": { id: "model-a", name: "Model A", cost: { input: 2, output: 4 } },
      free: { cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 } },
      invalid: { cost: { input: -1, output: 3 } },
      incomplete: { cost: { input: 2 } },
    },
  },
};

function manualPrice(inputUSD = 9): UsageModelPrice {
  return {
    providerId: "vendor",
    modelId: "model-a",
    source: "manual",
    inputUSD,
    outputUSD: 10,
    cacheReadUSD: null,
    cacheWriteUSD: null,
  };
}

function fixture(
  options: {
    pricing?: Partial<UsagePricingSettings>;
    request?: () => Promise<Response>;
  } = {},
) {
  let settings = { usagePricing: usagePricingSettingsSchema.parse(options.pricing ?? {}) };
  let fetchCount = 0;
  let writeCount = 0;
  const snapshots: AppUsageRequest[] = [];
  const dependencies = {
    settingService: {
      async get() {
        return structuredClone(settings) as AppSettings;
      },
      async update(patch) {
        writeCount += 1;
        settings = { usagePricing: structuredClone(patch.usagePricing!) };
      },
    },
    apiClient: {
      async request(input, init) {
        fetchCount += 1;
        assert.equal(input, "https://models.dev/api.json");
        assert.equal(init?.credentials, "omit");
        return options.request ? options.request() : Response.json(catalog);
      },
    },
    shucodeAgentService: {
      async getAppUsageStats(request) {
        snapshots.push(request);
        return {} as AppUsageSnapshot;
      },
    },
  } satisfies Parameters<typeof createUsageStatsService>[0];
  const service = createUsageStatsService(dependencies);
  return {
    service,
    snapshots,
    pricing: () => structuredClone(settings.usagePricing),
    fetchCount: () => fetchCount,
    writeCount: () => writeCount,
    otherService: () => createUsageStatsService(dependencies),
  };
}

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("catalog preserves explicit zero prices, provider identity and unknown cache costs", async () => {
  const f = fixture();
  const prices = await f.service.getModelsDevPrices();
  assert.equal(prices.length, 2);
  assert.deepEqual(
    prices.find((p) => p.modelId === "free"),
    {
      modelId: "free",
      providerId: "vendor",
      source: "models-dev",
      catalogKey: "vendor/free",
      inputUSD: 0,
      outputUSD: 0,
      cacheReadUSD: 0,
      cacheWriteUSD: 0,
    },
  );
  assert.equal(prices.find((p) => p.modelId === "model-a")?.cacheReadUSD, null);
  await f.service.getModelsDevPrices();
  assert.equal(f.fetchCount(), 1);
});

test("manual price validation rejects invalid values and accepts zero without writes on failure", async () => {
  const f = fixture();
  await assert.rejects(f.service.savePrice({ ...manualPrice(), inputUSD: Number.NaN }));
  await assert.rejects(f.service.savePrice({ ...manualPrice(), outputUSD: -1 }));
  assert.equal(f.writeCount(), 0);
  const result = await f.service.savePrice({ ...manualPrice(0), outputUSD: 0 });
  assert.equal(result.entries[0]?.inputUSD, 0);
  assert.equal(f.fetchCount(), 0);
});

test("default pricing queries do not access the network and settings writes preserve one another", async () => {
  const f = fixture();
  await f.service.getPricing();
  await Promise.all([
    f.service.savePrice(manualPrice()),
    f.service.savePrice({ ...manualPrice(), modelId: "model-b", providerId: undefined }),
    f.service.setModelsDevAutoSync(true),
  ]);
  assert.equal(f.pricing().entries.length, 2);
  assert.equal(f.pricing().modelsDevAutoSync, true);
  assert.equal(f.fetchCount(), 0);
});

test("an edit committed during the catalog fetch survives import and later forced sync", async () => {
  const response = gate<Response>();
  const started = gate<void>();
  let first = true;
  const f = fixture({
    request: async () => {
      if (!first) return Response.json(catalog);
      first = false;
      started.resolve();
      return response.promise;
    },
  });
  const importing = f.service.importModelsDevPrices(["vendor/model-a"]);
  await started.promise;
  await f.service.savePrice(manualPrice());
  response.resolve(Response.json(catalog));
  await importing;
  assert.equal(f.pricing().entries.find((p) => p.modelId === "model-a")?.inputUSD, 9);
  await f.service.syncModelsDevPrices();
  assert.equal(f.pricing().entries[0]?.source, "manual");
  assert.equal(f.pricing().entries[0]?.inputUSD, 9);
  assert.equal(f.fetchCount(), 2);
});

test("concurrent forced sync and price reads share one request and six-hour success interval", async () => {
  const response = gate<Response>();
  const started = gate<void>();
  const f = fixture({
    pricing: { modelsDevAutoSync: true, modelsDevSelectedKeys: ["vendor/model-a"] },
    request: async () => {
      started.resolve();
      return response.promise;
    },
  });
  const syncing = f.service.syncModelsDevPrices();
  await started.promise;
  const concurrent = [
    f.service.syncModelsDevPrices(),
    f.service.getPricing(),
    f.service.getPricing(),
  ];
  response.resolve(Response.json(catalog));
  await Promise.all([syncing, ...concurrent]);
  assert.equal(f.fetchCount(), 1);
  assert.ok(f.pricing().lastSyncedAt);
  await f.service.getPricing();
  assert.equal(f.fetchCount(), 1);
});

test("sync failure keeps prices and successful time, while snapshots continue with old prices", async () => {
  const f = fixture({
    pricing: {
      entries: [manualPrice()],
      modelsDevAutoSync: true,
      modelsDevSelectedKeys: ["vendor/model-a"],
      lastSyncedAt: 1,
    },
    request: async () => {
      throw new Error("fixture unavailable");
    },
  });
  const before = f.pricing();
  await assert.rejects(f.service.getPricing(), /fixture unavailable/);
  assert.deepEqual(f.pricing(), before);
  await f.service.getAppUsageSnapshot({ range: "today", dashboard: {} });
  assert.deepEqual(f.snapshots[0]?.dashboard?.prices, before.entries);
  assert.deepEqual(f.pricing(), before);
});

test("unselected catalog keys are rejected, deletion removes their sync selection", async () => {
  const f = fixture();
  await assert.rejects(f.service.importModelsDevPrices(["vendor/invalid"]));
  assert.equal(f.writeCount(), 0);
  const imported = await f.service.importModelsDevPrices(["vendor/free"]);
  const deleted = await f.service.deletePrice(usagePriceKey(imported.entries[0]!));
  assert.deepEqual(deleted.entries, []);
  assert.deepEqual(deleted.modelsDevSelectedKeys, []);
});

test("dashboard requests use the owner price snapshot while legacy requests remain compatible", async () => {
  const f = fixture({ pricing: { entries: [manualPrice()] } });
  await f.service.getAppUsageSnapshot({
    range: "7d",
    timeZone: "Asia/Shanghai",
    dashboard: { providerId: "vendor", page: 2, until: 123, prices: [] },
  });
  assert.deepEqual(f.snapshots[0]?.dashboard?.prices, [manualPrice()]);
  assert.equal(f.snapshots[0]?.dashboard?.page, 2);
  assert.equal(f.snapshots[0]?.dashboard?.until, 123);
  await f.service.getAppUsageSnapshot({ range: "all" });
  assert.equal(f.snapshots[1]?.dashboard, undefined);
});

test("price identity rename replaces the old row and sync selection in one settings write", async () => {
  const f = fixture();
  const imported = await f.service.importModelsDevPrices(["vendor/model-a"]);
  const previous = imported.entries[0]!;
  const writesBefore = f.writeCount();
  const result = await f.service.savePrice(
    { ...previous, providerId: "custom-provider" },
    usagePriceKey(previous),
  );
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.providerId, "custom-provider");
  assert.equal(result.entries[0]?.source, "manual");
  assert.deepEqual(result.modelsDevSelectedKeys, []);
  assert.equal(f.writeCount(), writesBefore + 1);
  await f.service.syncModelsDevPrices();
  assert.equal(f.pricing().entries.length, 1);
});

test("manual sync remains forceful alongside an automatic query within the success interval", async () => {
  const f = fixture({
    pricing: {
      modelsDevAutoSync: true,
      modelsDevSelectedKeys: ["vendor/model-a"],
      lastSyncedAt: Date.now(),
    },
  });
  await Promise.all([f.service.getPricing(), f.service.syncModelsDevPrices()]);
  assert.equal(f.fetchCount(), 1);
  assert.equal(f.pricing().entries[0]?.inputUSD, 2);
});

test("Environment service instances sharing one Host settings owner serialize price writes", async () => {
  const f = fixture();
  const other = f.otherService();
  await Promise.all([
    f.service.savePrice(manualPrice()),
    other.savePrice({ ...manualPrice(), modelId: "model-b" }),
    f.service.setModelsDevAutoSync(true),
  ]);
  assert.equal(f.pricing().entries.length, 2);
  assert.equal(f.pricing().modelsDevAutoSync, true);
});

test("deleting a manual override without a catalog draft removes the original sync selection", async () => {
  const f = fixture();
  await f.service.importModelsDevPrices(["vendor/model-a"]);
  await f.service.savePrice(manualPrice());
  await f.service.deletePrice(usagePriceKey(manualPrice()));
  await f.service.syncModelsDevPrices();
  assert.deepEqual(f.pricing().entries, []);
  assert.deepEqual(f.pricing().modelsDevSelectedKeys, []);
});
