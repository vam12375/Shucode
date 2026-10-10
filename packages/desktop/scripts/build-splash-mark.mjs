#!/usr/bin/env node
/**
 * 生成启动壳 Chef 的像素网格数据。
 *
 * 透明 Chef 是 64×64 的像素画（512px / 8px 栅格），启动动画需要逐格驱动，
 * 因此这里把资产量化成「调色板 + 4bit 索引」的紧凑串，直接内联进 index.html。
 * 生成物必须可复现：任何改动都应由本脚本产出，不手写 base64。
 *
 * 用法：node packages/desktop/scripts/build-splash-mark.mjs [--check]
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
// 像素超频使用透明 Chef；红底应用图标会把组装动画变成整块背景吸附。
const assetPath = resolve(repoRoot, "packages/ui/src/assets/pixel-kitchen/chef.png");
const htmlPath = resolve(repoRoot, "packages/desktop/src/renderer/index.html");

/** 资产原生栅格：512px 画布按 8px 分格。 */
const CELL = 8;
/** 参与逐格动画的格子总数上限，超过则说明资产换了尺寸，需要重新确认。 */
const EXPECTED_GRID = 64;

const png = PNG.sync.read(await readFile(assetPath));
const { width, height, data } = png;
if (width % CELL !== 0 || height % CELL !== 0) {
  throw new Error(`Chef 尺寸 ${width}×${height} 不能整除 ${CELL}px 栅格`);
}
const gridW = width / CELL;
const gridH = height / CELL;
if (gridW !== EXPECTED_GRID || gridH !== EXPECTED_GRID) {
  throw new Error(`Chef 栅格为 ${gridW}×${gridH}，与预期的 ${EXPECTED_GRID} 不符`);
}

// 以格子中心取样；中心点命中半透明像素时四舍五入到最近的原色，避免引入杂色。
const cells = [];
for (let gy = 0; gy < gridH; gy++) {
  for (let gx = 0; gx < gridW; gx++) {
    const cx = gx * CELL + (CELL >> 1);
    const cy = gy * CELL + (CELL >> 1);
    const i = (cy * width + cx) * 4;
    cells.push({
      r: data[i],
      g: data[i + 1],
      b: data[i + 2],
      a: data[i + 3],
    });
  }
}

// 按出现频次排序调色板，索引 0 固定留给透明格。
const opaqueCounts = new Map();
for (const c of cells) {
  if (c.a < 128) continue;
  const key = `${c.r},${c.g},${c.b}`;
  opaqueCounts.set(key, (opaqueCounts.get(key) || 0) + 1);
}
const palette = [...opaqueCounts.keys()].sort(
  (a, b) => opaqueCounts.get(b) - opaqueCounts.get(a) || a.localeCompare(b),
);
if (palette.length > 15) {
  throw new Error(`调色板 ${palette.length} 色超出 4bit 索引容量`);
}

const paletteRgb = palette.map((key) => key.split(",").map(Number));
const indexOfColor = (c) => {
  if (c.a < 128) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < paletteRgb.length; i++) {
    const [r, g, b] = paletteRgb[i];
    const dist = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  // 索引 0 是透明，实体色从 1 开始。
  return best + 1;
};

const indices = cells.map((c) => {
  const key = `${c.r},${c.g},${c.b}`;
  if (c.a >= 128 && opaqueCounts.has(key)) return palette.indexOf(key) + 1;
  return indexOfColor(c);
});

// 两个索引压进一个字节，hex 串比 base64 更易在 HTML 里核对。
const packed = [];
for (let i = 0; i < indices.length; i += 2) {
  packed.push((indices[i] << 4) | (indices[i + 1] ?? 0));
}
const packedHex = Buffer.from(packed).toString("hex");

const paletteHex = paletteRgb
  .map(([r, g, b]) => ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0"))
  .join(",");

const payload = {
  grid: gridW,
  cell: CELL,
  palette: paletteHex,
  packed: packedHex,
};

console.log("Chef 资产:", assetPath);
console.log("栅格:", `${gridW}×${gridH}`, "格子边长:", CELL);
console.log("调色板:", palette.length, "色", paletteHex);
console.log("实体格:", indices.filter((i) => i > 0).length, "/", indices.length);
console.log("压缩后字节:", packed.length, "hex 长度:", packedHex.length);
console.log(JSON.stringify(payload).length, "JSON 字符（写入 index.html 的规模）");

const block = `<!-- splash-mark-data:start（由 packages/desktop/scripts/build-splash-mark.mjs 生成，勿手改） -->
    <script type="application/json" id="splash-mark-data">${JSON.stringify(payload)}</script>
    <!-- splash-mark-data:end -->`;

const html = await readFile(htmlPath, "utf-8");
const marker = /<!-- splash-mark-data:start[\s\S]*?splash-mark-data:end -->/;
const currentBlock = html.match(marker)?.[0];
if (!currentBlock) {
  throw new Error("index.html 里找不到 splash-mark-data 标记，无法写入");
}

// HTML/JSON 格式化不等于像素数据变更；按字段与键集校验，保留已格式化的原文。
let samePayload = false;
try {
  const json = currentBlock.match(
    /<script\b[^>]*\bid=["']splash-mark-data["'][^>]*>([\s\S]*?)<\/script>/,
  )?.[1];
  const actual = JSON.parse(json ?? "");
  samePayload =
    actual !== null &&
    typeof actual === "object" &&
    !Array.isArray(actual) &&
    Object.keys(actual).length === Object.keys(payload).length &&
    Object.entries(payload).every(
      ([key, value]) => Object.hasOwn(actual, key) && actual[key] === value,
    );
} catch {
  // 损坏或缺失的 JSON 与资产不一致；生成模式重建，--check 仍明确失败。
}

if (process.argv.includes("--check")) {
  if (!samePayload) {
    console.error("\n启动壳像素数据与资产不一致，请重新生成。");
    process.exit(1);
  }
  console.log("\n--check 通过：index.html 数据与资产一致。");
  process.exit(0);
}

if (!samePayload) {
  await writeFile(htmlPath, html.replace(marker, block), "utf-8");
  console.log("\n已写入 index.html");
} else {
  console.log("\nindex.html 已是该数据，无需改写");
}
