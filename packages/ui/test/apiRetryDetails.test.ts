import assert from "node:assert/strict";
import test from "node:test";
import {
  formatNextRetryTime,
  resolveApiRetryRawErrorText,
  resolveApiRetryReasonText,
} from "../src/chat-input-toolbar/apiRetryDetails.js";

// node:test 环境没有完整 IntlProvider；用最小 intl stub 断言 messageId 命中。
const intl = {
  formatMessage: ({ id }: { id: string }) => `msg:${id}`,
} as unknown as Parameters<typeof resolveApiRetryReasonText>[1];

test("reason text maps normalized reasonCode to readable message", () => {
  assert.equal(
    resolveApiRetryReasonText("fault.network.timeout", intl),
    "msg:chat.apiRetryReason.networkTimeout",
  );
  assert.equal(
    resolveApiRetryReasonText("fault.provider.rateLimited", intl),
    "msg:chat.apiRetryReason.rateLimited",
  );
  // 未知 reasonCode 原样显示，不猜测、不编造。
  assert.equal(
    resolveApiRetryReasonText("fault.provider.unknownNew", intl),
    "fault.provider.unknownNew",
  );
  assert.equal(resolveApiRetryReasonText("", intl), null);
  assert.equal(resolveApiRetryReasonText(undefined, intl), null);
});

test("raw error text is suppressed when it duplicates the reason line", () => {
  // v4 路径 error=reasonCode：可读原因之外保留原始 code 便于反馈。
  assert.equal(
    resolveApiRetryRawErrorText("fault.network.timeout", "请求超时"),
    "fault.network.timeout",
  );
  // 原始文本与原因一致（未收录 code 原样显示时）不再重复。
  assert.equal(
    resolveApiRetryRawErrorText("fault.provider.unknownNew", "fault.provider.unknownNew"),
    null,
  );
  assert.equal(resolveApiRetryRawErrorText(undefined, "请求超时"), null);
});

test("next retry renders absolute time only for a valid epoch snapshot", () => {
  assert.equal(formatNextRetryTime(0, "en-US"), null);
  assert.equal(formatNextRetryTime(-5, "en-US"), null);
  assert.equal(formatNextRetryTime(Number.NaN, "en-US"), null);
  const label = formatNextRetryTime(Date.UTC(2026, 9, 15, 2, 30, 5), "en-US");
  assert.ok(label);
  assert.match(label, /\d{2}:\d{2}/);
});
