#!/usr/bin/env node
/* eslint-disable max-lines -- 回归矩阵按场景展开，保持每个验收条件可读。 */
/** Real Chromium regression checks of the production HTML startup owner. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const rendererRoot = resolve(fileURLToPath(new URL("../src/renderer/", import.meta.url)));
const source = await readFile(resolve(rendererRoot, "index.html"), "utf8");
const entryPattern = /<script\s+type="module"\s+src="\.\/src\/main\.tsx"><\/script>/;
const dataPattern =
  /(<script type="application\/json" id="splash-mark-data">)([\s\S]*?)(<\/script>)/;
assert.match(source, entryPattern, "production main.tsx entry was not found");
assert.match(source, dataPattern, "production inline mark data was not found");
const data = JSON.parse(source.match(dataPattern)[2]);
const mimeTypes = {
  ".woff2": "font/woff2",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function servedHtml(query) {
  // Only stub the app entry; the production animation receives its existing ready event.
  let html = source.replace(
    entryPattern,
    `<script type="module">
    document.getElementById("root").innerHTML = '<span>isolated startup test root</span>';
    const notify = () => {
      window.__SHUCODE_REACT_COMMIT_AT__ = Date.now();
      window.dispatchEvent(new Event("shucode-react-startup-ready"));
    };
    ${query.has("lateReady") ? "" : "notify();"}
  </script>`,
  );
  if (query.has("lateReady")) {
    // Isolate late-ready from the existing recovery timer in test-served HTML only.
    html = html.replace(
      /(?:window\.)?setTimeout\(markReactReady,\s*3000\)/g,
      "setTimeout(markReactReady, 60000)",
    );
    assert.ok(html.includes("60000"), "late-ready fixture could not isolate the recovery timer");
  }
  const broken = query.get("data");
  if (broken) {
    const variants = {
      json: "{invalid",
      palette: JSON.stringify({ ...data, palette: "" }),
      index: JSON.stringify({ ...data, packed: `f${data.packed.slice(1)}` }),
    };
    html =
      broken === "missing"
        ? html.replace(dataPattern, "")
        : html.replace(dataPattern, `$1${variants[broken]}$3`);
  }
  if (query.has("noCanvas")) {
    const before = html;
    html = html.replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/g, "");
    assert.notEqual(html, before, "no-canvas fixture did not remove canvas");
  }
  return html;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = servedHtml(url.searchParams);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = resolve(rendererRoot, path.startsWith("fonts/") ? `public/${path}` : path);
    if (!file.startsWith(`${rendererRoot}${sep}`) || !(await stat(file)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(file)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.SHUCODE_SPLASH_BROWSER_PATH
      ? { executablePath: process.env.SHUCODE_SPLASH_BROWSER_PATH }
      : { channel: "chrome" }),
    headless: true,
  });
} catch (error) {
  await new Promise((done) => server.close(done));
  throw error;
}
const failures = [];

async function scenario(name, options, test) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: options.dpr ?? 1,
    colorScheme: options.dark ? "dark" : "light",
    reducedMotion: options.reduce ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.addInitScript(
    ({ background, noContext, earlyCommit }) => {
      const request = window.requestAnimationFrame.bind(window);
      const cancel = window.cancelAnimationFrame.bind(window);
      const scheduled = new Map();
      let next = 100000;
      let count = 0;
      window.requestAnimationFrame = (callback) => {
        count += 1;
        if (background) {
          const id = next++;
          scheduled.set(id, callback);
          return id;
        }
        return request(callback);
      };
      window.cancelAnimationFrame = (id) => {
        scheduled.delete(id);
        cancel(id);
      };
      window.__splashTest = { count: () => count, pending: () => scheduled.size };
      if (noContext) HTMLCanvasElement.prototype.getContext = () => null;
      if (earlyCommit) {
        window.__SHUCODE_REACT_COMMIT_AT__ = Date.now();
        window.dispatchEvent(new Event("shucode-react-startup-ready"));
      }
    },
    {
      background: options.background,
      noContext: options.noContext,
      earlyCommit: options.earlyCommit,
    },
  );
  if (options.fontFailure) await page.route("**/*.woff2", (route) => route.abort("failed"));
  if (options.fontPending) await page.route("**/*.woff2", () => {});
  try {
    await page.goto(`${baseUrl}/index.html?${options.query ?? ""}`, {
      waitUntil: options.fontPending ? "domcontentloaded" : "load",
    });
    if (!options.fontPending) await page.evaluate(() => document.fonts.ready);
    await test(page);
    assert.deepEqual(errors, [], "startup shell threw an uncaught exception");
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = `${error instanceof Error ? error.message : String(error)}${errors.length ? `; page errors: ${errors.join("; ")}` : ""}`;
    failures.push({ name, message });
    console.error(`FAIL ${name}: ${message}`);
  } finally {
    await context.close();
  }
}

async function masked(page) {
  assert.equal(
    await page.locator("#loading").count(),
    1,
    "loading was removed before animation/React handshake",
  );
  assert.equal(
    await page.evaluate(() => document.body.classList.contains("shucode-startup-ready")),
    false,
    "handoff started before both signals",
  );
}

async function entered(page) {
  assert.equal(
    await page.locator("#loading").count(),
    0,
    "loading was not removed after handshake",
  );
  assert.equal(
    await page.evaluate(() => document.body.classList.contains("shucode-startup-ready")),
    true,
    "root was not released",
  );
}

async function ready(page) {
  await page.evaluate(() => window.dispatchEvent(new Event("shucode-react-startup-ready")));
}

try {
  await scenario("early-ready-seven-second-gate-and-duplicate", {}, async (page) => {
    await page.clock.runFor(6800);
    await masked(page);
    await page.clock.runFor(1200);
    await entered(page);
    const count = await page.evaluate(() => window.__splashTest.count());
    await ready(page);
    await ready(page);
    await page.clock.runFor(1000);
    await entered(page);
    assert.equal(
      await page.evaluate(() => window.__splashTest.count()),
      count,
      "duplicate ready restarted animation",
    );
  });

  await scenario(
    "ready-arrives-before-owner-listener",
    { query: "lateReady", earlyCommit: true },
    async (page) => {
      await page.clock.runFor(6800);
      await masked(page);
      await page.clock.runFor(1200);
      await entered(page);
    },
  );

  await scenario("late-ready-holds-final-frame", { query: "lateReady" }, async (page) => {
    await page.clock.runFor(7800);
    await masked(page);
    const count = await page.evaluate(() => window.__splashTest.count());
    const before = await page.locator("#loading canvas").evaluate((canvas) => canvas.toDataURL());
    await page.clock.runFor(1000);
    const after = await page.locator("#loading canvas").evaluate((canvas) => canvas.toDataURL());
    assert.equal(after, before, "final frame was still changing");
    assert.equal(
      await page.evaluate(() => window.__splashTest.count()),
      count,
      "final frame kept scheduling RAF",
    );
    await ready(page);
    await page.clock.runFor(500);
    await entered(page);
  });

  await scenario("background-raf-recovery", { background: true }, async (page) => {
    await page.clock.runFor(8000);
    await entered(page);
    assert.equal(
      await page.evaluate(() => window.__splashTest.pending()),
      0,
      "pending background RAF",
    );
  });

  await scenario("reduced-motion-immediate-handoff", { reduce: true }, async (page) => {
    await page.clock.runFor(100);
    await entered(page);
    assert.equal(
      await page.evaluate(() => window.__splashTest.count()),
      0,
      "reduced motion scheduled RAF",
    );
    const animations = await page.evaluate(
      () =>
        document.getAnimations().filter((animation) => animation.playState === "running").length,
    );
    assert.equal(animations, 0, "reduced motion retained transitions or blinking");
  });

  await scenario(
    "startup-animation-disabled-skips-animation",
    { query: "startupAnimation=false" },
    async (page) => {
      // 设置里关闭开场动画后，main 注入 startupAnimation=false：跳过逐帧动画但仍等 React 就绪再交接。
      await page.clock.runFor(100);
      await entered(page);
      assert.equal(
        await page.evaluate(() => window.__splashTest.count()),
        0,
        "disabled startup animation scheduled RAF",
      );
    },
  );

  await scenario(
    "startup-animation-enabled-plays",
    { query: "startupAnimation=true" },
    async (page) => {
      // 显式 startupAnimation=true 与缺省一致：仍需走满 7 秒动画门，不被开关短路。
      await page.clock.runFor(6800);
      await masked(page);
      await page.clock.runFor(1200);
      await entered(page);
      assert.ok(
        (await page.evaluate(() => window.__splashTest.count())) > 0,
        "enabled startup animation never scheduled RAF",
      );
    },
  );

  for (const broken of ["json", "palette", "index", "missing"]) {
    await scenario(`invalid-data-${broken}`, { query: `data=${broken}` }, async (page) => {
      await page.clock.runFor(600);
      await entered(page);
      assert.equal(
        await page.evaluate(() => window.__splashTest.count()),
        0,
        "invalid data started animation",
      );
    });
  }

  for (const canvasCase of ["noCanvas", "noContext"]) {
    await scenario(
      `fallback-${canvasCase}`,
      { query: canvasCase === "noCanvas" ? "noCanvas" : "", noContext: canvasCase === "noContext" },
      async (page) => {
        await page.clock.runFor(600);
        await entered(page);
      },
    );
  }

  await scenario("failed-font-uses-fallback", { fontFailure: true }, async (page) => {
    await page.clock.runFor(6800);
    await masked(page);
    await page.clock.runFor(1200);
    await entered(page);
  });

  await scenario("pending-font-has-bounded-recovery", { fontPending: true }, async (page) => {
    await page.clock.runFor(8100);
    await entered(page);
  });

  await scenario(
    "update-status-bypasses-all-animation",
    { query: "windowKind=update-status", noContext: true },
    async (page) => {
      await entered(page);
      assert.equal(
        await page.evaluate(() => window.__splashTest.count()),
        0,
        "update status scheduled RAF",
      );
    },
  );

  for (const dimensions of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 900, height: 520 },
  ]) {
    await scenario(
      `dpr2-dark-resize-${dimensions.width}x${dimensions.height}`,
      { viewport: dimensions, dpr: 2, dark: true, query: "lateReady" },
      async (page) => {
        await page.clock.runFor(4000);
        assert.equal(await page.evaluate(() => window.devicePixelRatio), 2);
        const size = await page.locator("#loading canvas").evaluate((canvas) => ({
          width: canvas.width,
          height: canvas.height,
          css: canvas.getBoundingClientRect().toJSON(),
        }));
        assert.ok(
          size.width >= size.css.width * 1.9 && size.height >= size.css.height * 1.9,
          "canvas backing buffer did not scale for DPR2",
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
          "horizontal overflow",
        );
        await page.setViewportSize({
          width: dimensions.width - 80,
          height: dimensions.height - 40,
        });
        await page.clock.runFor(3800);
        await masked(page);
        const count = await page.evaluate(() => window.__splashTest.count());
        await page.clock.runFor(500);
        assert.equal(
          await page.evaluate(() => window.__splashTest.count()),
          count,
          "resize restarted or prolonged animation",
        );
        await ready(page);
        await page.clock.runFor(500);
        await entered(page);
        await page.setViewportSize(dimensions);
        await page.clock.runFor(500);
        assert.equal(
          await page.evaluate(() => window.__splashTest.count()),
          count,
          "post-handoff resize restarted animation",
        );
      },
    );
  }

  for (const dimensions of [
    { width: 480, height: 640 },
    { width: 1200, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    for (const zoom of [Math.pow(1.1, -3), 1, Math.pow(1.1, 5)]) {
      await scenario(
        `fullscreen-canvas-${dimensions.width}x${dimensions.height}-zoom-${zoom.toFixed(2)}`,
        {
          viewport: {
            width: Math.round(dimensions.width / zoom),
            height: Math.round(dimensions.height / zoom),
          },
          dpr: 2 * zoom,
          query: "lateReady",
        },
        async (page) => {
          for (const elapsed of [700, 1400, 1400, 2500]) {
            await page.clock.runFor(elapsed);
            const geometry = await page.locator("#loading canvas").evaluate((canvas) => {
              const rect = canvas.getBoundingClientRect();
              const loading = document.getElementById("loading").getBoundingClientRect();
              const stage = document.getElementById("loading").dataset.stage;
              const dpr = canvas.width / rect.width;
              const image = canvas
                .getContext("2d")
                .getImageData(0, 0, canvas.width, Math.ceil(64 * dpr)).data;
              let darkTopPixels = 0;
              for (let i = 0; i < image.length; i += 4)
                if (image[i] < 70 && image[i + 1] < 70 && image[i + 2] < 70 && image[i + 3] === 255)
                  darkTopPixels++;
              return {
                canvasCoversLoading:
                  Math.abs(rect.top - loading.top) < 0.1 &&
                  Math.abs(rect.left - loading.left) < 0.1 &&
                  Math.abs(rect.width - loading.width) < 0.1 &&
                  Math.abs(rect.height - loading.height) < 0.1,
                stage,
                darkTopPixels,
              };
            });
            assert.equal(
              geometry.canvasCoversLoading,
              true,
              "canvas no longer covers the full loading surface",
            );
            if (geometry.stage === "kinetic")
              assert.ok(
                geometry.darkTopPixels > 0,
                "kinetic cut did not continue through the top of the canvas",
              );
          }
          await ready(page);
          await page.clock.runFor(2000);
          await entered(page);
        },
      );
    }
  }
} finally {
  await browser.close();
  // 字体挂起场景会留下 HTTP keep-alive 连接；只关闭本次隔离测试服务器的连接。
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
if (failures.length > 0) {
  console.error(`\n${failures.length} startup splash check(s) failed.`);
  process.exitCode = 1;
} else console.log("\nAll startup splash checks passed.");
