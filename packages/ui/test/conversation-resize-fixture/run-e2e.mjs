import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { installResizeMetrics } from "./instrumentation.mjs";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(directory, "../../../..");
const url = process.env.RESIZE_FIXTURE_URL ?? "http://127.0.0.1:5191";
const output = resolve(root, "output/playwright/conversation-resize");
await mkdir(output, { recursive: true });
const server = process.env.RESIZE_FIXTURE_URL
  ? null
  : spawn(
      process.execPath,
      [
        resolve(root, "node_modules/vite/bin/vite.js"),
        "--config",
        resolve(directory, "vite.config.mts"),
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
let serverOutput = "";
server?.stdout.on("data", (data) => {
  serverOutput += data;
});
server?.stderr.on("data", (data) => {
  serverOutput += data;
});
let browser;
const results = [];
const errors = [];
const report = { results, errors, animations: [] };

try {
  // Wait for readiness with a bounded network probe; do not reuse a user's browser session.
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(serverOutput);
    try {
      if ((await fetch(url)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, `Fixture did not start: ${serverOutput}`);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.RESIZE_FIXTURE_BROWSER
      ? { executablePath: process.env.RESIZE_FIXTURE_BROWSER }
      : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(installResizeMetrics);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const byId = (id) => page.getByTestId(id);
  const settled = async () => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
  };
  const open = async (query = "") => {
    await page.goto(`${url}/?${query}`);
    await byId("composer-toolbar").waitFor();
    await settled();
  };
  const width = async (value) => {
    await page.evaluate((value) => window.resizeFixture.width(value), value);
    await settled();
  };
  const metrics = () => page.evaluate(() => ({ ...window.resizeMetrics }));
  const snapshot = () =>
    page.evaluate(() => {
      const root = document.querySelector('[data-testid="composer-toolbar"]');
      const states = ["computer", "mode", "plan", "thought"].map(
        (id) => root.querySelector(`[data-testid="${id}"]`)?.dataset.composerCompact ?? "full",
      );
      const leading = root.querySelector("[data-composer-leading-content]").getBoundingClientRect();
      const trailing = root
        .querySelector("[data-composer-trailing-actions]")
        .getBoundingClientRect();
      return {
        states,
        provider: root.dataset.composerProviderCompact === "true",
        model: root.dataset.composerModelIcon === "true",
        overlap: leading.right > trailing.left + 1,
      };
    });
  const check = (name) => {
    results.push(name);
    console.log(`PASS ${name}`);
  };
  const assertNoOverflow = async () => {
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.equal(
      await page.evaluate(() => {
        const main = document.querySelector("main").getBoundingClientRect();
        const toolbar = document.querySelector('[data-testid="composer-toolbar"]');
        const controls = [...toolbar.querySelectorAll("button")].map((node) =>
          node.getBoundingClientRect(),
        );
        return (
          main.left >= 0 &&
          main.right <= innerWidth + 1 &&
          controls.every((rect) => rect.left >= 0 && rect.right <= innerWidth + 1)
        );
      }),
      true,
      "Fixture or toolbar controls extend beyond the viewport",
    );
  };

  for (const text of ["short", "long"]) {
    await open(`text=${text}&platform=desktop`);
    const initial = await metrics();
    const draft = await byId("draft").inputValue();
    await byId("draft").focus();
    for (let index = 0; index < 8; index += 1) {
      // These clicks deliberately reverse an unfinished 200ms CSS width transition.
      await byId("toggle-panel").click();
      await page.waitForTimeout(35);
    }
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-testid="right-panel"]');
      return panel.dataset.open === "false" && panel.getBoundingClientRect().width < 1;
    });
    await settled();
    const final = await metrics();
    report.animations.push({
      text,
      clones: final.clones - initial.clones,
      probes: final.probes - initial.probes,
    });
    assert.equal(
      final.clones - initial.clones,
      0,
      `${text}: width-only animation created ${final.clones - initial.clones} toolbar clones`,
    );
    assert.equal(final.probes - initial.probes, 0);
    assert.equal(await byId("draft").inputValue(), draft);
    assert.equal(await byId("draft").evaluate((node) => document.activeElement === node), true);
    assert.equal((await snapshot()).overlap, false);
    await assertNoOverflow();
    check(
      `${text} text: eight rapid reversals reuse measurements, retain draft/focus and restore layout`,
    );
  }

  await open();
  await page.evaluate(() =>
    window.resizeFixture.model("claude-opus-4-8-with-an-extended-model-label"),
  );
  await settled();
  const observedStages = new Set();
  for (let value = 1100; value >= 220; value -= 4) {
    await width(value);
    const state = await snapshot();
    // Product order: Computer -> mode -> Plan -> think label -> provider -> think icon -> model.
    const collapsed = [
      state.states[0] !== "full",
      state.states[1] !== "full",
      state.states[2] !== "full",
      state.states[3] !== "full",
      state.provider,
      state.states[3] === "icon",
      state.model,
    ];
    const firstFull = collapsed.indexOf(false);
    assert.ok(
      firstFull < 0 || collapsed.slice(firstFull).every((value) => !value),
      `Collapse priority violated at ${value}px: ${JSON.stringify(state)}`,
    );
    observedStages.add(collapsed.filter(Boolean).length);
  }
  assert.deepEqual(
    [...observedStages].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  await width(1100);
  assert.deepEqual((await snapshot()).states, ["full", "full", "full", "full"]);
  assert.equal((await snapshot()).provider, false);
  assert.equal((await snapshot()).model, false);
  check("all seven shrink stages preserve priority and restore full labels after widening");

  await open();
  let beforeBreakpoint = await metrics();
  await width(360);
  let afterBreakpoint = await metrics();
  assert.ok(
    afterBreakpoint.clones > beforeBreakpoint.clones,
    "New @sm container layout was not measured",
  );
  assert.ok(
    afterBreakpoint.clones - beforeBreakpoint.clones <= 8,
    "Container breakpoint measured more than one fit profile",
  );
  for (const value of [900, 320, 500, 350, 1100]) await width(value);
  assert.equal(
    (await metrics()).clones,
    afterBreakpoint.clones,
    "Revisiting cached container layouts rebuilt their probes",
  );
  check("crossing @sm measures a new profile once and revisiting each side reuses it");

  await width(650);
  let previous = await metrics();
  await page.evaluate(() => window.resizeFixture.locale("zh"));
  await settled();
  assert.ok(
    (await metrics()).clones > previous.clones,
    "Locale change did not invalidate measurements",
  );
  assert.match(await byId("mode").textContent(), /完全访问/);
  assert.equal((await snapshot()).overlap, false);
  previous = await metrics();
  await page.evaluate(() =>
    window.resizeFixture.model("a-much-longer-model-name-for-cache-invalidation"),
  );
  await settled();
  assert.ok(
    (await metrics()).clones > previous.clones,
    "Model text change did not invalidate measurements",
  );
  assert.equal((await snapshot()).overlap, false);
  previous = await metrics();
  await page.evaluate(() => window.resizeFixture.computer(false));
  await settled();
  assert.ok(
    (await metrics()).clones > previous.clones,
    "Removing a dynamic slot did not invalidate measurements",
  );
  assert.equal(await byId("computer").count(), 0);
  await page.evaluate(() => window.resizeFixture.computer(true));
  await settled();
  assert.equal(await byId("computer").count(), 1);
  assert.equal((await snapshot()).overlap, false);
  previous = await metrics();
  await page.evaluate(async () => {
    const label = document.querySelector('[data-testid="mode"] span');
    for (let frame = 0; frame < 8; frame += 1) {
      label.style.transform = `translateY(${frame}px)`;
      label.style.opacity = String(frame / 8);
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    }
    label.style.removeProperty("transform");
    label.style.removeProperty("opacity");
  });
  await settled();
  assert.equal(
    (await metrics()).clones,
    previous.clones,
    "Presentation-only motion invalidated the width cache",
  );
  check(
    "Chinese/model/dynamic-slot changes invalidate the cache; transform/opacity animation reuses it",
  );

  previous = await metrics();
  await page.evaluate(
    async (fontUrl) => {
      const face = new FontFace("ResizeFixtureLoadedFont", `url(${JSON.stringify(fontUrl)})`);
      document.fonts.add(face);
      document.querySelector('[data-testid="composer-toolbar"]').style.fontFamily =
        "ResizeFixtureLoadedFont, serif";
      await document.fonts.load('14px "ResizeFixtureLoadedFont"');
      await document.fonts.ready;
    },
    `/@fs/${resolve(root, "packages/ui/src/assets/pixel-kitchen/fusion-pixel-12.woff2")}`,
  );
  await settled();
  assert.ok(
    (await metrics()).clones > previous.clones,
    "Font loading did not invalidate measurements",
  );
  assert.equal((await snapshot()).overlap, false);
  check("real bundled font loading invalidates measurements without overlap");

  previous = await metrics();
  await page.evaluate(() => document.documentElement.style.setProperty("--ui-font-size", "18px"));
  await settled();
  assert.ok(
    (await metrics()).clones > previous.clones,
    "UI font-size setting did not invalidate measurements",
  );
  assert.equal((await snapshot()).overlap, false);
  check("changing the UI font-size setting recalculates fit at the current width");

  await open("platform=desktop");
  await byId("mode").click();
  await page.getByRole("menu").waitFor();
  for (const value of [700, 950, 600, 1100]) await width(value);
  assert.equal(await page.getByRole("menu").isVisible(), true);
  assert.equal(
    await page.getByRole("menu").evaluate((node) => node.contains(document.activeElement)),
    true,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  assert.equal(await byId("mode").evaluate((node) => document.activeElement === node), true);
  check("open Radix menu and keyboard focus survive shrinking/restoring the toolbar");

  for (const viewport of [390, 320]) {
    await page.setViewportSize({ width: viewport, height: 844 });
    await open("text=long");
    await assertNoOverflow();
    assert.equal((await snapshot()).overlap, false);
    await page.screenshot({ path: resolve(output, `mobile-${viewport}.png`) });
  }
  check("320px and 390px mobile layouts have no toolbar overlap or document overflow");

  const scheduledBeforeUnmount = await page.evaluate(async () => {
    document
      .querySelector('[data-testid="composer-toolbar"]')
      .setAttribute("style", "letter-spacing: 0.1px");
    // Deliver MutationObserver now, then unmount before the requested animation frame.
    await Promise.resolve();
    const pending = window.resizeMetrics.pendingHookRafs;
    window.resizeFixture.unmount();
    return pending;
  });
  assert.ok(scheduledBeforeUnmount > 0, "Teardown scenario did not have pending hook work");
  await byId("composer-toolbar").waitFor({ state: "detached" });
  await settled();
  const unmounted = await metrics();
  assert.equal(unmounted.resizeObservers, 0);
  assert.equal(unmounted.mutationObservers, 0);
  assert.equal(unmounted.pendingHookRafs, 0);
  assert.equal(unmounted.detachedHookRafs, 0);
  assert.equal(
    await page.locator('[data-testid="composer-toolbar"][aria-hidden="true"]').count(),
    0,
  );
  assert.equal(await page.locator('[data-composer-toolbar-measurement="true"]').count(), 0);
  await page.evaluate(() => dispatchEvent(new Event("resize")));
  await settled();
  assert.equal((await metrics()).clones, unmounted.clones);
  check("unmount cancels observers/rAF, removes probes and ignores later resize events");

  const fallbackPage = await context.newPage();
  await fallbackPage.addInitScript(() => {
    delete window.ResizeObserver;
  });
  await fallbackPage.goto(url);
  await fallbackPage.getByTestId("composer-toolbar").waitFor();
  await fallbackPage.evaluate(async () => {
    await document.fonts.ready;
    window.resizeFixture.width(390);
  });
  await fallbackPage.waitForFunction(
    () => document.querySelector("main").getBoundingClientRect().width === 390,
  );
  await fallbackPage.evaluate(() => dispatchEvent(new Event("resize")));
  await fallbackPage.waitForFunction(
    () => document.querySelector('[data-testid="mode"]').dataset.composerCompact === "true",
  );
  assert.equal(
    await fallbackPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await fallbackPage.close();
  check("without ResizeObserver, initialization and window resize still fit the toolbar");
  assert.deepEqual(errors, []);
  report.passed = results.length;
} finally {
  await writeFile(resolve(output, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  if (server && server.exitCode === null) server.kill("SIGTERM");
  console.log(JSON.stringify(report, null, 2));
}
