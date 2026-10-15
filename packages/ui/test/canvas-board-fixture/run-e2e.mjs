import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(directory, "../../../..");
const url = process.env.CANVAS_FIXTURE_URL ?? "http://127.0.0.1:5194";
const output = resolve(root, "output/playwright/canvas-board");
await mkdir(output, { recursive: true });
const server = process.env.CANVAS_FIXTURE_URL
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
    ...(process.env.CANVAS_FIXTURE_BROWSER ? { executablePath: process.env.CANVAS_FIXTURE_BROWSER } : {}),
  });

  let scopeSeq = 0;
  const newScope = () => `s${Date.now().toString(36)}${(scopeSeq += 1)}`;

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const byId = (id) => page.getByTestId(id);
  const noteEditors = page.locator('[data-testid^="canvas-note-editor-"]');
  const wallItems = page.locator('[data-testid^="canvas-home-wall-item-"]');
  const open = async (scope, opts = {}) => {
    const locale = opts.locale ?? "zh";
    const theme = opts.theme ?? "light";
    await page.goto(`${url}/?locale=${locale}&theme=${theme}&scope=${scope}`);
    await byId("canvas-home").waitFor();
    await settled();
  };
  const settled = async () => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
  };
  const wallItemIds = () =>
    page.evaluate(() => {
      // 活墙 marquee 下同一 board 有多份 DOM，按 id 去重
      const ids = [...document.querySelectorAll('[data-testid^="canvas-home-wall-item-"]')].map(
        (el) => el.getAttribute("data-testid").replace("canvas-home-wall-item-", ""),
      );
      return [...new Set(ids)];
    });
  const withVisibleWallItem = async (boardId, action) => {
    // 先 hover 容器暂停滚动，再挑选位于裁剪区内的可见实例执行动作
    await page.getByTestId("canvas-home-wall").hover();
    const handles = await page.getByTestId(`canvas-home-wall-item-${boardId}`).elementHandles();
    const wallBox = await page.getByTestId("canvas-home-wall").boundingBox();
    for (const handle of handles) {
      const box = await handle.boundingBox();
      if (
        box &&
        wallBox &&
        box.x >= wallBox.x - 2 &&
        box.x + box.width <= wallBox.x + wallBox.width + 2
      ) {
        await action(handle);
        return;
      }
    }
    throw new Error(`no visible wall item for ${boardId}`);
  };
  const clickWallItem = (boardId) => withVisibleWallItem(boardId, (handle) => handle.click());
  const backToHome = async () => {
    // 详情页「返回」收进左上角 Logo 菜单：先开菜单再点「回到画布首页」项。
    await byId("canvas-board-menu").click();
    await backToHome();
  };
  const indexDump = (scope) =>
    page.evaluate((scopeId) => {
      const key = `shucode-canvas-index-${encodeURIComponent(`/tmp/canvas-fixture-${scopeId}`)}`;
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, scope);

  // ---- 进入首页 → 新建 → 编辑器 → 保存文案 ----
  const scopeA = newScope();
  await open(scopeA);
  await page.screenshot({ path: `${output}/home-empty.png` });
  await byId("canvas-home-new").click();
  await byId("canvas-board").waitFor();
  await byId("canvas-add-note").click();
  await noteEditors.first().waitFor();
  await noteEditors.first().fill("Hello Seedance");
  await page.locator(".react-flow__pane").click({ position: { x: 30, y: 30 } });
  await settled();
  const indexAfterCreate = await indexDump(scopeA);
  assert.equal(indexAfterCreate?.boards?.length, 1, "new board lands in the index");
  assert.match(indexAfterCreate?.boards?.[0]?.name ?? "", /画布 1/, "default zh name");
  check("home: create board via landing tile opens the editor");

  // ---- 返回首页 → 活墙出现 → 重开（文本保留） ----
  await backToHome();
  await byId("canvas-home").waitFor();
  assert.equal(await wallItems.count(), 1);
    const boardIdA = (await wallItemIds())[0];
    await clickWallItem(boardIdA);
  await byId("canvas-board").waitFor();
  await noteEditors.first().waitFor();
  assert.equal(await noteEditors.first().inputValue(), "Hello Seedance");
  await check("home: wall item reopens board with persisted text");

  // ---- 编辑器内连线（拖拽 handle→handle）----
  await byId("canvas-add-note").click();
  await page.waitForTimeout(300);
  const sourceHandle = page.locator(".react-flow__handle.source").first();
  const targetHandle = page.locator(".react-flow__handle.target").nth(1);
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetHandle.boundingBox();
  assert.ok(sourceBox && targetBox, "both handles must exist");
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await settled();
  const docScopeDump = await page.evaluate((scopeId) => {
    const keys = Object.keys(localStorage).filter(
      (name) => name.startsWith("shucode-canvas-doc-") && name.includes(encodeURIComponent(scopeId)),
    );
    const docs = keys.map((key) => JSON.parse(localStorage.getItem(key)));
    return docs.reduce((sum, doc) => sum + (doc.edges?.length ?? 0), 0);
  }, `/tmp/canvas-fixture-${scopeA}`);
  assert.equal(docScopeDump, 1, "edge persisted");
  await check("editor: dragging between handles persists an edge");

  // ---- 回首页 → 新建第二块 → 删除确认 ----
  await backToHome();
  await byId("canvas-home").waitFor();
  await byId("canvas-home-new").click();
  await byId("canvas-board").waitFor();
  await backToHome();
  await byId("canvas-home").waitFor();
  assert.equal((await wallItemIds()).length, 2);
  // hover 可见实例使删除钮出现（withVisibleWallItem 已暂停滚动），destructive 确认框
  const deleteId = (await wallItemIds()).find((id) => id !== boardIdA);
  await withVisibleWallItem(deleteId, (handle) => handle.hover());
  await page.getByTestId(`canvas-home-wall-remove-${deleteId}`).first().click();
  await page.getByTestId("confirm-dialog-confirm").waitFor();
  await page.getByTestId("confirm-dialog-confirm").click();
  await settled();
  assert.equal(await wallItems.count(), 1);
  const indexAfterDelete = await indexDump(scopeA);
  assert.equal(indexAfterDelete?.boards?.length, 1);
  await check("home: remove requires confirm and prunes index");

  // ---- 详情页（参考 libtv）：全屏无边框 + Logo 菜单 + 画布切换 + 左侧面板 + 空态 chips ----
  await clickWallItem(boardIdA);
  await byId("canvas-board").waitFor();
  await byId("canvas-board-panel").waitFor();
  const boardFrame = await page.getByTestId("canvas-board").evaluate((el) => {
    const style = getComputedStyle(el);
    return { radius: style.borderTopLeftRadius, borderTop: style.borderTopWidth };
  });
  assert.equal(boardFrame.radius, "0px", "detail page must be borderless (no radius)");
  assert.equal(boardFrame.borderTop, "0px", "detail page must be borderless (no border)");
  // 面板默认展开：两块便签各出一条目，底部计数同步
  const nodeItems = page.locator('[data-testid^="canvas-board-panel-node-item-"]');
  await nodeItems.first().waitFor();
  assert.equal(await nodeItems.count(), 2);
  assert.match(await byId("canvas-board-panel").innerText(), /共 2 节点/);
  // 已有节点：中央空态提示与占位 chips 不出现
  assert.equal(await byId("canvas-board-empty-actions").count(), 0);
  // 收起 → 左下角「资产管理」重开
  await byId("canvas-board-panel-collapse").click();
  await page.locator('[data-testid="canvas-board-panel"]').waitFor({ state: "detached" });
  await byId("canvas-board-panel-open").click();
  await byId("canvas-board-panel").waitFor();
  await check("editor: borderless fullscreen with left panel collapse/reopen");

  // 菜单内新建画布并自动进入：新板为空 → 空态提示 + 5 个禁用占位 chips
  await byId("canvas-board-menu").click();
  await byId("canvas-board-menu-new").click();
  await byId("canvas-board-empty-actions").waitFor();
  assert.equal(
    await page.locator('[data-testid="canvas-board-empty-actions"] button[disabled]').count(),
    5,
  );
  assert.match(await byId("canvas-board-switch").innerText(), /画布 2/);
  assert.match(await byId("canvas-board-panel").innerText(), /画布暂无节点/);

  // 切换下拉回到画布 1，内容保留
  await byId("canvas-board-switch").click();
  await byId(`canvas-board-switch-item-${boardIdA}`).click();
  await noteEditors.first().waitFor();
  assert.equal(await noteEditors.first().inputValue(), "Hello Seedance");

  // 菜单删除当前画布 → destructive 确认 → 回首页，索引只剩画布 2
  await byId("canvas-board-menu").click();
  await byId("canvas-board-menu-delete").click();
  await page.getByTestId("confirm-dialog-confirm").waitFor();
  await page.getByTestId("confirm-dialog-confirm").click();
  await byId("canvas-home").waitFor();
  await settled();
  assert.equal((await wallItemIds()).length, 1);
  const indexAfterEditorDelete = await indexDump(scopeA);
  assert.equal(indexAfterEditorDelete?.boards?.length, 1);
  await check("editor: logo menu creates, switches and deletes boards");

  // ---- 旧版单文档迁移 ----
  const scopeB = newScope();
  const legacyKey = `shucode-canvas-board-${encodeURIComponent(`/tmp/canvas-fixture-${scopeB}`)}`;
  await open(scopeB);
  await page.evaluate(([key]) => {
    localStorage.setItem(
      key,
      JSON.stringify({ nodes: [{ id: "n1", type: "note", position: { x: 0, y: 0 }, data: { text: "legacy" } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: 123 }),
    );
  }, [legacyKey]);
  await page.reload();
  await byId("canvas-home").waitFor();
  await settled();
  const migrated = await indexDump(scopeB);
  assert.equal(migrated?.boards?.length, 1, "legacy board migrated");
  assert.equal(migrated?.boards?.[0]?.name, "Canvas");
  const legacyGone = await page.evaluate(([key]) => localStorage.getItem(key) === null, [legacyKey]);
  assert.ok(legacyGone, "legacy key removed after migration");
  // 打开迁移板，legacy 文本保留
  await wallItems.first().click();
  await byId("canvas-board").waitFor();
  await noteEditors.first().waitFor();
  assert.equal(await noteEditors.first().inputValue(), "legacy");
  await check("legacy single board migrates into named board");

  // ---- en / 深色冒烟 + 截图 ----
  await open(newScope(), { locale: "en", theme: "dark" });
  assert.match(await byId("canvas-home-new").innerText(), /New canvas/);
  await page.screenshot({ path: `${output}/home-en-dark.png` });
  check("home: en locale renders");

  // 回到 zh 浅色收个尾图
  await open(scopeA);
  await page.screenshot({ path: `${output}/home-light.png` });

  assert.deepEqual(errors, [], "no page errors");
} finally {
  await browser?.close();
  server?.kill();
}

console.log(`\n${results.length} checks passed; screenshots in ${output}`);
