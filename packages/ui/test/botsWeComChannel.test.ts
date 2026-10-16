import assert from "node:assert/strict";
import test from "node:test";
import { BOT_PROVIDERS, getBotReplyGranularitiesForProvider } from "../src/botsUi.js";
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";

const WECOM_MESSAGE_KEYS = [
  "bots.channel.wecom",
  "bots.newBot.providerDescription.wecom",
  "bots.providerSettings.wecom",
  "bots.botTokenDescription.wecom",
  "bots.wecomRegistrationButton",
  "bots.wecomRegistrationRefresh",
  "bots.wecomRegistrationQrAlt",
  "bots.wecomRegistrationOpenPage",
  "bots.wecomRegistrationScanHint",
  "bots.wecomRegistrationStarted",
  "bots.wecomRegistrationSuccess",
  "bots.wecomRegistrationFailed",
  "bots.wecomRegistration.pending",
  "bots.wecomRegistration.success",
  "bots.wecomRegistration.expired",
  "bots.wecomRegistration.error",
  "bots.wecomManualToggle",
  "bots.wecomManualHint",
] as const;

// 字段占位符（Bot ID）在中英文里都是产品术语，允许两语一致。
const WECOM_SHARED_TERM_KEYS = ["bots.wecomBotIdPlaceholder"] as const;

const WECOM_RUNTIME_MESSAGE_KEYS = [
  "bots.runtime.wecomWebSocketStarting",
  "bots.runtime.wecomWebSocketConnecting",
  "bots.runtime.wecomWebSocketRunning",
  "bots.runtime.wecomWebSocketStopped",
  "bots.runtime.wecomWebSocketHandledElsewhere",
] as const;

test("wecom: 渠道入口已开放", () => {
  const entry = BOT_PROVIDERS.find((item) => item.id === "wecom");
  assert.ok(entry, "wecom provider entry is missing");
  assert.equal(entry.implemented, true);
  assert.equal(entry.label, "WeCom");
});

test("wecom: 两种 locale 覆盖新增文案且不再是占位", () => {
  for (const key of [...WECOM_MESSAGE_KEYS, ...WECOM_RUNTIME_MESSAGE_KEYS]) {
    assert.ok(zhCN[key]?.trim(), `zh-CN missing ${key}`);
    assert.ok(enUS[key]?.trim(), `en-US missing ${key}`);
    assert.notEqual(zhCN[key], enUS[key], `${key} should differ across locales`);
  }
  for (const key of WECOM_SHARED_TERM_KEYS) {
    assert.ok(zhCN[key]?.trim(), `zh-CN missing ${key}`);
    assert.ok(enUS[key]?.trim(), `en-US missing ${key}`);
  }
  // 「即将支持」占位文案不允许回潮。
  assert.ok(!zhCN["bots.providerSettings.wecom"]!.includes("暂未开放"));
  assert.ok(!zhCN["bots.newBot.providerDescription.wecom"]!.includes("规划中"));
  assert.ok(!enUS["bots.providerSettings.wecom"]!.includes("not available yet"));
});

test("wecom: 回复粒度沿用通用文本粒度，不含飞书专用流式卡片", () => {
  const granularityIds = getBotReplyGranularitiesForProvider("wecom").map((item) => item.id);
  assert.ok(granularityIds.includes("assistant_changes"));
  assert.ok(!granularityIds.includes("streaming_card"));
});
