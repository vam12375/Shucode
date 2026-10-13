import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  invalidateMarketplaceReadCache,
  loadKnownMarketplacesSync,
  loadMarketplaceManifestSync,
  listInstalledPluginRecords,
  removeMarketplace,
} from "../src/plugins/marketplace.js";

function makeTempStorageRoot(): string {
  return mkdtempSync(join(tmpdir(), "shucode-marketplace-cache-"));
}

function writeKnownFile(storageRoot: string, name: string, pluginCount: number): void {
  writeFileSync(
    join(storageRoot, "known_marketplaces.json"),
    `${JSON.stringify({
      version: 1,
      marketplaces: [
        {
          id: "demo",
          name,
          pluginCount,
          source: { source: "url", url: "https://example.invalid/marketplace.json" },
        },
      ],
    })}\n`,
    "utf8",
  );
}

test.beforeEach(() => {
  invalidateMarketplaceReadCache();
});

test("known marketplaces list is memoized until invalidated or rewritten", () => {
  const storageRoot = makeTempStorageRoot();
  writeKnownFile(storageRoot, "first", 1);
  assert.deepEqual(
    loadKnownMarketplacesSync(storageRoot).map((record) => record.name),
    ["first"],
  );

  // TTL 窗口内磁盘直改不生效——这正是挂载缓存要省掉的重复读。
  writeKnownFile(storageRoot, "second", 2);
  assert.deepEqual(
    loadKnownMarketplacesSync(storageRoot).map((record) => record.name),
    ["first"],
  );

  invalidateMarketplaceReadCache();
  assert.deepEqual(
    loadKnownMarketplacesSync(storageRoot).map((record) => record.name),
    ["second"],
  );
  rmSync(storageRoot, { recursive: true, force: true });
});

test("module-level writes invalidate the known-list cache", async () => {
  const storageRoot = makeTempStorageRoot();
  writeKnownFile(storageRoot, "first", 1);
  assert.equal(loadKnownMarketplacesSync(storageRoot)[0]?.name, "first");

  // removeMarketplace 内部走 writeKnownMarketplaces → 必须立即失效读缓存，
  // 否则下一行会命中 TTL 内的旧列表。
  await removeMarketplace({ marketplace: "demo", storageRoot });
  assert.deepEqual(loadKnownMarketplacesSync(storageRoot), []);
  rmSync(storageRoot, { recursive: true, force: true });
});

test("cached records are freshly parsed per call so caller mutations do not leak", () => {
  const storageRoot = makeTempStorageRoot();
  writeKnownFile(storageRoot, "first", 1);
  const first = loadKnownMarketplacesSync(storageRoot)[0];
  assert.ok(first);
  first.name = "mutated";
  const second = loadKnownMarketplacesSync(storageRoot)[0];
  assert.notEqual(first, second);
  assert.notEqual(second?.name, "mutated");
  rmSync(storageRoot, { recursive: true, force: true });
});

test("marketplace manifest reads are memoized until invalidated", () => {
  const storageRoot = makeTempStorageRoot();
  const marketplaceDir = join(storageRoot, "marketplaces", "demo");
  mkdirSync(marketplaceDir, { recursive: true });
  const manifestPath = join(marketplaceDir, "marketplace.json");
  const writeManifest = (name: string): void => {
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ name, plugins: [{ name: "demo-plugin" }], raw: {} })}\n`,
      "utf8",
    );
  };
  writeManifest("demo-marketplace");
  assert.equal(loadMarketplaceManifestSync(storageRoot, "demo")?.name, "demo-marketplace");

  writeManifest("renamed-marketplace");
  assert.equal(loadMarketplaceManifestSync(storageRoot, "demo")?.name, "demo-marketplace");

  invalidateMarketplaceReadCache();
  assert.equal(loadMarketplaceManifestSync(storageRoot, "demo")?.name, "renamed-marketplace");
  rmSync(storageRoot, { recursive: true, force: true });
});

test("installed plugin records use the same cached-text layer", () => {
  const storageRoot = makeTempStorageRoot();
  const writeInstalled = (installPath: string): void => {
    writeFileSync(
      join(storageRoot, "installed_plugins.json"),
      `${JSON.stringify({
        version: 1,
        plugins: [
          {
            id: "demo-plugin@demo",
            name: "demo-plugin",
            marketplace: "demo",
            version: "0.1.0",
            installPath,
            installedAt: "2026-10-13T00:00:00.000Z",
            scope: "user",
          },
        ],
      })}\n`,
      "utf8",
    );
  };
  writeInstalled("/tmp/a");
  assert.equal(listInstalledPluginRecords(storageRoot)[0]?.installPath, "/tmp/a");
  writeInstalled("/tmp/b");
  assert.equal(listInstalledPluginRecords(storageRoot)[0]?.installPath, "/tmp/a");
  invalidateMarketplaceReadCache();
  assert.equal(listInstalledPluginRecords(storageRoot)[0]?.installPath, "/tmp/b");
  rmSync(storageRoot, { recursive: true, force: true });
});
