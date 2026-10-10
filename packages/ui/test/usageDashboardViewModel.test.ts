import assert from "node:assert/strict";
import test from "node:test";
import {
  createUsagePriceDraft,
  filterModelsDevPrices,
  formatUsageUSD,
  parseUsagePriceDraft,
} from "../src/settings/usage-stats/usageDashboardViewModel.js";

test("manual prices distinguish explicit zero, missing cache prices and invalid numbers", () => {
  const draft = {
    ...createUsagePriceDraft(),
    modelId: " model/example ",
    inputUSD: "0",
    outputUSD: "2.5",
  };
  const price = parseUsagePriceDraft(draft);
  assert.ok(price);
  assert.equal(price.inputUSD, 0);
  assert.equal(price.cacheReadUSD, null);
  assert.equal(price.modelId, "model/example");
  for (const value of ["", "-1", "NaN", "Infinity"]) {
    assert.equal(parseUsagePriceDraft({ ...draft, inputUSD: value }), null);
  }
  assert.equal(parseUsagePriceDraft({ ...draft, cacheWriteUSD: "-1" }), null);
});

test("unknown cost remains unknown while free calls display zero", () => {
  assert.equal(formatUsageUSD("en-US", null, "Unpriced"), "Unpriced");
  assert.equal(formatUsageUSD("en-US", 0, "Unpriced"), "$0.00");
  assert.equal(formatUsageUSD("en-US", 0.000123, "Unpriced"), "$0.000123");
});

test("catalog search distinguishes suppliers with the same model identifier", () => {
  const base = parseUsagePriceDraft({
    ...createUsagePriceDraft(),
    modelId: "shared-model",
    inputUSD: "1",
    outputUSD: "2",
  });
  assert.ok(base);
  const prices = [
    { ...base, providerId: "Vendor A" },
    { ...base, providerId: "Vendor B" },
  ];
  assert.deepEqual(
    filterModelsDevPrices(prices, " vendor b ").map((price) => price.providerId),
    ["Vendor B"],
  );
  assert.equal(filterModelsDevPrices(prices, "SHARED").length, 2);
});
