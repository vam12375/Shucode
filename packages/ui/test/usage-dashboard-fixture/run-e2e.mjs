import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { resolve } from "node:path";

const browser = await chromium.connectOverCDP(process.env.USAGE_FIXTURE_CDP_URL);
const context = browser.contexts()[0];
const page = context.pages()[0];
const output = resolve("output/playwright/usage-dashboard");
await mkdir(output, { recursive: true });
const checks = [];
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const byId = (id) => page.getByTestId(id);
const waitReady = async () => {
  await byId("usage-refresh").waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="usage-refresh"]')?.disabled,
  );
};
const select = async (id, name) => {
  await byId(id).click();
  await page.getByRole("option", { name, exact: true }).click();
  await waitReady();
};
const overflow = async () =>
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
const screenshot = async (name) => {
  if (!(await byId("usage-dashboard-heatmap").count()))
    await page
      .locator('[data-testid="usage-trend-chart"] .recharts-bar-rectangle')
      .first()
      .waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/${name}.png` });
};
const open = async (query) => {
  await page.goto(`http://127.0.0.1:5188/?${query}`);
  await waitReady();
};

await page.setViewportSize({ width: 1440, height: 1000 });
await open("platform=desktop&locale=zh&theme=light");
await page.locator('[data-testid="usage-trend-chart"] .recharts-bar-rectangle').first().waitFor();
assert.match(await byId("usage-summary-requests").innerText(), /50/);
assert.equal(await page.locator('[data-testid="usage-table-logs"] tbody tr').count(), 20);
await overflow();
await screenshot("desktop-zh-light");
check("desktop metrics, nonblank chart, 20-row bounded page and no page overflow");

await byId("usage-page-next").click();
await waitReady();
assert.ok(await page.evaluate(() => window.usageFixture.requests.at(-1).dashboard.after));
assert.match(await page.locator('[data-testid="usage-table-logs"]').innerText(), /第 2 \/ 3 页/);
await byId("usage-page-previous").click();
await waitReady();
assert.match(await page.locator('[data-testid="usage-table-logs"]').innerText(), /第 1 \/ 3 页/);
check("next and previous pagination preserve fixed snapshot");
await select("usage-provider-filter", "fixture-provider");
assert.match(await byId("usage-summary-requests").innerText(), /25/);
await select("usage-model-filter", "fixture-model");
assert.match(await byId("usage-summary-requests").innerText(), /17/);
await select("usage-status-filter", "失败");
assert.equal(await page.locator('[data-testid="usage-table-logs"] tbody tr').count(), 9);
await byId("usage-tab-providers").click();
await byId("usage-table-providers").waitFor();
await byId("usage-tab-models").click();
await byId("usage-table-models").waitFor();
check("supplier/model/status filters and aggregate tabs");

await open("platform=desktop&locale=zh&theme=light");
await byId("usage-metric-cost").click();
await byId("usage-metric-requests").click();
for (const label of ["近 24 小时", "近 14 日"]) await select("usage-range-filter", label);
await select("usage-range-filter", "自定义");
await byId("usage-custom-since").fill("2026-10-09T00:00");
await byId("usage-custom-apply").click();
await waitReady();
assert.equal(await page.evaluate(() => window.usageFixture.requests.at(-1).until), undefined);
await byId("usage-custom-follow-now").click();
await byId("usage-custom-until").fill("2026-10-11T00:00");
await byId("usage-custom-apply").click();
await waitReady();
assert.ok(await page.evaluate(() => window.usageFixture.requests.at(-1).until));
check("24h/14d/custom datetime and following current time");

await byId("usage-scope-all-clients").click();
await waitReady();
assert.equal(await page.locator('[data-testid^="usage-client-"]').count(), 10);
assert.match(await byId("usage-summary-requests").innerText(), /60/);
await byId("usage-client-codex").click();
await waitReady();
assert.equal(await page.locator('[data-testid="usage-table-logs"] tbody tr').count(), 2);
await byId("usage-client-dsh-desktop").click();
await waitReady();
await page.getByRole("status").filter({ hasText: "Fixture permission failure" }).waitFor();
await byId("usage-client-all").click();
await waitReady();
await select("usage-range-filter", "全部时间");
await byId("usage-dashboard-heatmap").waitFor();
await byId("usage-heatmap-metric-cost").click();
await byId("usage-heatmap-metric-requests").click();
await overflow();
await screenshot("desktop-all-clients-heatmap");
check("stable client icons, source error, all-time heatmap and metric controls");

await byId("usage-tab-pricing").click();
await byId("usage-pricing-add").waitFor();
await page.waitForFunction(
  () => !document.querySelector('[data-testid="usage-pricing-add"]')?.disabled,
);
await byId("usage-pricing-add").click();
await byId("usage-price-modelId").fill("zero-model");
for (const field of ["inputUSD", "outputUSD", "cacheReadUSD", "cacheWriteUSD"])
  await byId(`usage-price-${field}`).fill("0");
await byId("usage-price-save").click();
await byId("usage-price-dialog").waitFor({ state: "hidden" });
assert.ok(
  await page.evaluate(() =>
    window.usageFixture
      .settings()
      .entries.some((entry) => entry.modelId === "zero-model" && entry.inputUSD === 0),
  ),
);
await byId("usage-price-edit-zero-model").click();
await byId("usage-price-modelId").fill("renamed-model");
await byId("usage-price-providerId").fill("fixture-provider");
await byId("usage-price-save").click();
await byId("usage-price-dialog").waitFor({ state: "hidden" });
assert.equal(
  await page.evaluate(() =>
    window.usageFixture.settings().entries.some((entry) => entry.modelId === "zero-model"),
  ),
  false,
);
await byId("usage-price-delete-renamed-model").click();
await byId("usage-price-confirm-delete").click();
await byId("usage-price-delete-renamed-model").waitFor({ state: "hidden" });
check("pricing CRUD with explicit zero and renamed provider/model key");

await byId("usage-pricing-import").click();
await byId("usage-catalog-search").fill("catalog-beta");
await page.getByRole("checkbox", { name: "fixture-provider catalog-beta", exact: true }).click();
await byId("usage-catalog-import").click();
await byId("usage-modelsdev-dialog").waitFor({ state: "hidden" });
await byId("usage-pricing-autosync").click();
await page.waitForFunction(() => window.usageFixture.settings().modelsDevAutoSync === true);
await byId("usage-pricing-sync").click();
await page.waitForFunction(
  () => !document.querySelector('[data-testid="usage-pricing-sync"]')?.disabled,
);
await screenshot("desktop-pricing");
check("catalog search/selection/import, auto sync and immediate sync");

await byId("usage-pricing-import-json").click();
await byId("usage-pricing-json-text").fill("not-json");
await byId("usage-pricing-json-import").click();
await page.getByRole("alert").filter({ hasText: "JSON" }).first().waitFor();
const json = JSON.stringify({
  version: 1,
  models: [
    {
      modelId: "json-import-model",
      inputCostPerMillion: "0",
      outputCostPerMillion: "2",
      cacheReadCostPerMillion: "0",
      cacheCreationCostPerMillion: "0",
    },
  ],
});
await byId("usage-pricing-json-text").fill(json);
await byId("usage-pricing-json-import").click();
await byId("usage-pricing-json-dialog").waitFor({ state: "hidden" });
assert.ok(
  await page.evaluate(() =>
    window.usageFixture.settings().entries.some((entry) => entry.modelId === "json-import-model"),
  ),
);
await byId("usage-pricing-import-json").click();
await byId("usage-pricing-json-file").setInputFiles({
  name: "model-pricing.json",
  mimeType: "application/json",
  buffer: Buffer.from(json.replace("json-import-model", "json-file-model")),
});
await byId("usage-pricing-json-import").click();
await byId("usage-pricing-json-dialog").waitFor({ state: "hidden" });
assert.ok(
  await page.evaluate(() =>
    window.usageFixture.settings().entries.some((entry) => entry.modelId === "json-file-model"),
  ),
);
check("CC Switch JSON invalid input, paste and local file import");

await byId("usage-pricing-import-json").click();
await page.evaluate(() => window.usageFixture.useLegacyImportCcSwitch());
await byId("usage-pricing-json-text").fill(json);
await byId("usage-pricing-json-import").click();
await page
  .getByRole("alert")
  .filter({ hasText: /background service has not updated|后台服务尚未更新/ })
  .waitFor();
await page.getByRole("button", { name: /Cancel|取消/, exact: true }).click();
check("legacy Host import RPC shows restart guidance");

await open("locale=en&theme=dark");
await page
  .locator('[data-testid="usage-table-logs"] tbody tr')
  .first()
  .locator("td")
  .nth(8)
  .locator("span")
  .hover();
await page.getByRole("tooltip", { name: "Estimated using current prices" }).waitFor();
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
await byId("usage-scope-all-clients").click();
await waitReady();
await byId("usage-client-claude-code").click();
await waitReady();
await page
  .locator('[data-testid="usage-table-logs"] tbody tr')
  .filter({ hasText: "fixture-unpriced" })
  .locator("td")
  .nth(8)
  .locator("span")
  .hover();
await page.getByRole("tooltip", { name: "Client-reported cost" }).waitFor();
check("request cost tooltip distinguishes current-price estimates and client reports");

await open("locale=en&theme=dark");
await select("usage-auto-refresh", "Auto refresh off");
await page.evaluate(() => window.usageFixture.holdNext());
await byId("usage-refresh").click();
assert.equal(
  await page.evaluate(() => window.usageFixture.requests.at(-1).dashboard.syncSources),
  true,
);
await page.waitForFunction(() => window.usageFixture.pending() === 1);
await select("usage-provider-filter", "fixture-provider");
assert.match(await byId("usage-summary-requests").innerText(), /25/);
await page.evaluate(() => window.usageFixture.release());
await page.waitForFunction(() => window.usageFixture.pending() === 0);
assert.match(await byId("usage-summary-requests").innerText(), /25/);
check("late old query cannot overwrite changed supplier scope");

await open("locale=en&theme=dark");
await select("usage-auto-refresh", "Auto refresh off");
await page.evaluate(() => window.usageFixture.holdNext());
await byId("usage-refresh").click();
await page.waitForFunction(() => window.usageFixture.pending() === 1);
await byId("usage-tab-pricing").click();
await byId("usage-price-edit-fixture-model").click();
for (const field of ["inputUSD", "outputUSD", "cacheReadUSD", "cacheWriteUSD"])
  await byId(`usage-price-${field}`).fill("0");
await byId("usage-price-save").click();
await byId("usage-price-dialog").waitFor({ state: "hidden" });
assert.match(await byId("usage-summary-cost").innerText(), /\$0\.00/);
await page.evaluate(() => window.usageFixture.release());
await page.waitForFunction(() => window.usageFixture.pending() === 0);
assert.match(await byId("usage-summary-cost").innerText(), /\$0\.00/);
check("pricing refresh invalidates in-flight response with old price snapshot");

await page.setViewportSize({ width: 390, height: 844 });
await open("locale=en&theme=dark");
await overflow();
await screenshot("mobile-en-dark");
await byId("usage-scope-all-clients").click();
await waitReady();
await select("usage-range-filter", "All time");
await overflow();
await screenshot("mobile-en-dark-heatmap");
await byId("usage-tab-pricing").click();
await byId("usage-pricing-add").click();
await screenshot("mobile-en-dark-price-dialog");
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await open("locale=zh&theme=light");
await overflow();
await screenshot("mobile-zh-light");
check("390x844 mobile light/dark and Chinese/English without document overflow");
await page.setViewportSize({ width: 1440, height: 1000 });
await open("platform=desktop&locale=en&theme=dark");
await overflow();
await screenshot("desktop-en-dark");
check("1440x1000 desktop dark English layout");
await page.clock.install({ time: Date.now() });
const initialRequests = await page.evaluate(() => window.usageFixture.requests.length);
await page.evaluate(() => window.usageFixture.holdNext());
await page.clock.fastForward(31_000);
await page.waitForFunction(() => window.usageFixture.pending() === 1);
await page.clock.fastForward(120_000);
assert.equal(await page.evaluate(() => window.usageFixture.requests.length), initialRequests + 1);
await page.evaluate(() => window.usageFixture.release());
await page.waitForFunction(() => window.usageFixture.pending() === 0);
await page.clock.fastForward(31_000);
assert.equal(await page.evaluate(() => window.usageFixture.requests.length), initialRequests + 2);
check("automatic refresh waits for completed queries and never piles up");
console.log(JSON.stringify({ passed: checks.length, checks, output }, null, 2));
await browser.close();
