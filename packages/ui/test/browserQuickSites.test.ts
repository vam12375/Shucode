import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_QUICK_SITES,
  BROWSER_QUICK_SITE_GROUPS,
  getBrowserQuickSitesByGroup,
} from "../src/browser-use/browserQuickSites.js";
import { normalizeBrowserUrl } from "../src/embeddedBrowserHelpers.js";
import zhCN from "../src/i18n/locales/zh-CN.js";
import enUS from "../src/i18n/locales/en-US.js";

test("quick sites: unique ids and both groups populated", () => {
  const ids = BROWSER_QUICK_SITES.map((site) => site.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    BROWSER_QUICK_SITE_GROUPS.map((group) => group.id),
    ["content", "search"],
  );
  assert.deepEqual(
    getBrowserQuickSitesByGroup("content").map((site) => site.id),
    ["xiaohongshu", "douyin", "bilibili"],
  );
  assert.deepEqual(
    getBrowserQuickSitesByGroup("search").map((site) => site.id),
    ["baidu", "weibo", "zhihu", "36kr"],
  );
  assert.equal(
    getBrowserQuickSitesByGroup("content").length + getBrowserQuickSitesByGroup("search").length,
    BROWSER_QUICK_SITES.length,
  );
});

test("quick sites: every URL is a public https URL accepted by the navigation whitelist", () => {
  for (const site of BROWSER_QUICK_SITES) {
    assert.equal(normalizeBrowserUrl(site.url), site.url, site.id);
    const parsed = new URL(site.url);
    assert.equal(parsed.protocol, "https:", site.id);
    assert.match(parsed.hostname, /^[a-z0-9.-]+$/, site.id);
    assert.equal(site.domain, parsed.hostname.replace(/^www\./, ""), site.id);
  }
});

test("quick sites: locales zh-CN and en-US both cover every message key", () => {
  const requiredKeys = [
    "browser.quickSites.title",
    "browser.quickSites.subtitle",
    ...BROWSER_QUICK_SITE_GROUPS.map((group) => group.messageId),
    ...BROWSER_QUICK_SITES.map((site) => `browser.quickSites.${site.id}`),
  ];
  for (const key of requiredKeys) {
    assert.ok(zhCN[key]?.trim(), `zh-CN missing ${key}`);
    assert.ok(enUS[key]?.trim(), `en-US missing ${key}`);
    assert.notEqual(zhCN[key], enUS[key], `${key} should differ across locales`);
  }
  // 旧空状态文案已由快速入口标题替代，不应再回潮。
  assert.equal(zhCN["browser.empty"], undefined);
  assert.equal(enUS["browser.empty"], undefined);
});

test("quick sites: brand tints are fixed 7-digit hex and monograms nonempty", () => {
  for (const site of BROWSER_QUICK_SITES) {
    assert.match(site.tint, /^#[0-9a-f]{6}$/i, site.id);
    assert.ok(site.monogram.trim().length > 0, site.id);
  }
});
