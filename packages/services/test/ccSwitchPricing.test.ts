import assert from "node:assert/strict";
import test from "node:test";
import {
  usagePricingSettingsSchema,
  type AppSettings,
  type UsageModelPrice,
} from "@shucode/shared";
import { parseCcSwitchPricing } from "../src/usage-stats/ccSwitchPricing.js";
import { createUsagePricing } from "../src/usage-stats/usagePricing.js";

const model = {
  modelId: "example-model",
  displayName: "Example",
  inputCostPerMillion: "2",
  outputCostPerMillion: "8",
  cacheReadCostPerMillion: "0.2",
  cacheCreationCostPerMillion: "0",
};

function fixture(entries: UsageModelPrice[] = []) {
  let settings = usagePricingSettingsSchema.parse({ entries });
  let writes = 0;
  const service = createUsagePricing({
    settingService: {
      async get() {
        return { usagePricing: structuredClone(settings) } as AppSettings;
      },
      async update(patch) {
        writes += 1;
        settings = structuredClone(patch.usagePricing!);
      },
    },
    apiClient: {
      async request() {
        throw new Error("Import must not fetch");
      },
    },
  });
  return { service, writes: () => writes, settings: () => settings };
}

test("CC Switch v1 camelCase decimal prices map directly with known zero intact", () => {
  const parsed = parseCcSwitchPricing(
    JSON.stringify({ version: 1, models: [model], modelsDevSync: { autoSyncEnabled: true } }),
  );
  assert.deepEqual(parsed.prices[0], {
    modelId: "example-model",
    displayName: "Example",
    source: "manual",
    inputUSD: 2,
    outputUSD: 8,
    cacheReadUSD: 0.2,
    cacheWriteUSD: 0,
  });
  assert.equal(parsed.sourceCount, 1);
});

test("CC Switch source normalization keeps last duplicate and filters its own tombstones", () => {
  const parsed = parseCcSwitchPricing(
    JSON.stringify({
      models: [model, { ...model, inputCostPerMillion: "3.5" }, { ...model, modelId: "deleted" }],
      deletedModelIds: ["deleted"],
    }),
  );
  assert.equal(parsed.prices.length, 1);
  assert.equal(parsed.prices[0]?.inputUSD, 3.5);
  assert.equal(parsed.sourceCount, 3);
});

test("CC Switch invalid JSON, future version, and invalid model field fail before writes", async () => {
  const f = fixture();
  for (const value of [
    "{",
    JSON.stringify({ version: 2 }),
    JSON.stringify({ models: [{ ...model, outputCostPerMillion: "NaN" }] }),
    JSON.stringify({ models: [{ ...model, cacheReadCostPerMillion: "-1" }] }),
  ]) {
    await assert.rejects(f.service.importCcSwitchPrices(value));
  }
  assert.throws(
    () =>
      parseCcSwitchPricing(JSON.stringify({ models: [{ ...model, inputCostPerMillion: "1e3" }] })),
    /models\.0\.inputCostPerMillion/,
  );
  assert.equal(f.writes(), 0);
});

test("CC Switch import is idempotent, preserves manual prices, and never migrates sync or deletions", async () => {
  const existing: UsageModelPrice = {
    modelId: "keep",
    source: "manual",
    inputUSD: 99,
    outputUSD: 99,
    cacheReadUSD: null,
    cacheWriteUSD: null,
  };
  const f = fixture([existing]);
  const json = JSON.stringify({
    version: 1,
    models: [model, { ...model, modelId: "keep" }, { ...model, modelId: "removed" }],
    deletedModelIds: ["keep", "removed"],
    modelsDevSync: { autoSyncEnabled: true, selectedModelKeys: ["secret-provider/model"] },
  });
  const first = await f.service.importCcSwitchPrices(json);
  assert.equal(first.imported, 1);
  assert.equal(first.skipped, 2);
  assert.equal(first.settings.entries.find((price) => price.modelId === "keep")?.inputUSD, 99);
  assert.equal(first.settings.modelsDevAutoSync, false);
  assert.deepEqual(first.settings.modelsDevSelectedKeys, []);
  const second = await f.service.importCcSwitchPrices(json);
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 3);
  assert.equal(second.settings.entries.length, 2);
});

test("CC Switch import and concurrent manual edit share the owner's write queue", async () => {
  const f = fixture();
  const manual: UsageModelPrice = {
    modelId: "manual",
    source: "manual",
    inputUSD: 8,
    outputUSD: 9,
    cacheReadUSD: null,
    cacheWriteUSD: null,
  };
  await Promise.all([
    f.service.importCcSwitchPrices(JSON.stringify({ models: [model] })),
    f.service.savePrice(manual),
  ]);
  assert.equal(f.settings().entries.length, 2);
  assert.equal(f.settings().entries.find((price) => price.modelId === "manual")?.inputUSD, 8);
});
