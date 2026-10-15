import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(directory, "../../../..");
const url = process.env.EMPTY_FIXTURE_URL ?? "http://127.0.0.1:5193";
const output = resolve(root, "output/playwright/browser-empty");
await mkdir(output, { recursive: true });
const server = process.env.EMPTY_FIXTURE_URL
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
const check = (name) => {
  results.push(name);
  console.log(`PASS ${name}`);
};

try {
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
    ...(process.env.EMPTY_FIXTURE_BROWSER
      ? { executablePath: process.env.EMPTY_FIXTURE_BROWSER }
      : {}),
  });
  const context = await browser.newContext({ viewport: { width: 720, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const byId = (id) => page.getByTestId(id);
  const item = (siteId) => byId(`browser-quick-site-item-${siteId}`);
  const settled = async () => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
  };
  const open = async (query = "") => {
    await page.goto(`${url}/?${query}`);
    await byId("browser-quick-sites").waitFor();
    await settled();
  };
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      "fixture viewport must not scroll horizontally",
    );

  // zh / 浅色：两组入口、站点文案、域名与顺序
  await open("locale=zh&theme=light");
  const title = await byId("browser-quick-sites").innerText();
  assert.match(title, /打开公开网站/);
  assert.match(title, /内容平台/);
  assert.match(title, /搜索与资讯/);
  // 内容平台卡片展示站点名 + 域名；搜索资讯条目按设计只展示站点名
  for (const [siteId, label, domain] of [
    ["xiaohongshu", "小红书", "xiaohongshu.com"],
    ["douyin", "抖音", "douyin.com"],
    ["bilibili", "哔哩哔哩", "bilibili.com"],
  ]) {
    const text = await item(siteId).innerText();
    assert.ok(text.includes(label), `${siteId} should show ${label}`);
    assert.ok(text.includes(domain), `${siteId} should show ${domain}`);
  }
  for (const [siteId, label] of [
    ["baidu", "百度搜索"],
    ["weibo", "微博"],
    ["zhihu", "知乎"],
    ["36kr", "36氪"],
  ]) {
    assert.ok((await item(siteId).innerText()).includes(label), `${siteId} should show ${label}`);
  }
  const groupTitles = await page.locator('[data-testid="browser-quick-sites"] h4').allInnerTexts();
  assert.deepEqual(groupTitles, ["内容平台", "搜索与资讯"]);
  await noOverflow();
  await page.screenshot({ path: `${output}/zh-light.png` });
  check("zh/light: header, two groups, 7 labeled entries in order");

  // 点击入口：onOpenUrl 收到规范 https 地址，与清单一致
  const expectedUrls = new Map([
    ["xiaohongshu", "https://www.xiaohongshu.com"],
    ["douyin", "https://www.douyin.com"],
    ["bilibili", "https://www.bilibili.com"],
    ["baidu", "https://www.baidu.com"],
    ["weibo", "https://weibo.com"],
    ["zhihu", "https://www.zhihu.com"],
    ["36kr", "https://www.36kr.com"],
  ]);
  for (const [siteId] of expectedUrls) {
    await item(siteId).click();
  }
  const opened = await page.evaluate(() => window.browserEmptyFixture.openedUrls);
  assert.deepEqual(opened, [...expectedUrls.values()]);
  check("clicking all 7 entries forwards the curated https URLs to openUrl");

  // en / 深色
  await open("locale=en&theme=dark");
  const enTitle = await byId("browser-quick-sites").innerText();
  assert.match(enTitle, /Open a website/);
  assert.match(enTitle, /Content platforms/);
  assert.match(enTitle, /Search & news/);
  assert.match(await item("xiaohongshu").innerText(), /rednote/);
  await noOverflow();
  await page.screenshot({ path: `${output}/en-dark.png` });
  check("en/dark: localized labels render");

  // 窄面板：文字截断且不横向溢出
  await page.setViewportSize({ width: 420, height: 900 });
  await settled();
  await noOverflow();
  const domainVisible = await item("xiaohongshu")
    .locator("span")
    .filter({ hasText: "xiaohongshu.com" })
    .evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      return Number.parseInt(getComputedStyle(el).textIndent ?? "0", 10) >= 0;
    })
    .catch(() => true);
  assert.ok(domainVisible, "truncated domain stays inside the card");
  await page.screenshot({ path: `${output}/zh-narrow.png` });
  check("narrow pane: grid wraps without horizontal overflow");

  assert.deepEqual(errors, [], "no page errors");
} finally {
  await browser?.close();
  server?.kill();
}

console.log(`\n${results.length} checks passed; screenshots in ${output}`);
