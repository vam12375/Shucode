import assert from "node:assert/strict";
import test from "node:test";
import {
  extractDeepLinkUrlFromArgs,
  extractPlatformCallbackFlowId,
  isPlatformCallbackUrl,
} from "../src/main/desktopDeepLinkUrl.js";

test("isPlatformCallbackUrl：识别 zcode://platform/callback", () => {
  assert.equal(isPlatformCallbackUrl(new URL("zcode://platform/callback?flow_id=abc")), true);
  assert.equal(isPlatformCallbackUrl(new URL("zcode:///platform/callback?flow_id=abc")), true);
  assert.equal(isPlatformCallbackUrl(new URL("zcode://platform/other?flow_id=abc")), false);
  assert.equal(isPlatformCallbackUrl(new URL("zcode://oauth/callback?state=abc")), false);
  assert.equal(isPlatformCallbackUrl(new URL("https://platform/callback?flow_id=abc")), false);
});

test("extractPlatformCallbackFlowId：仅返回非空 flow_id", () => {
  assert.equal(
    extractPlatformCallbackFlowId(new URL("zcode://platform/callback?flow_id=flow-1")),
    "flow-1",
  );
  assert.equal(extractPlatformCallbackFlowId(new URL("zcode://platform/callback")), null);
  assert.equal(
    extractPlatformCallbackFlowId(new URL("zcode://platform/callback?flow_id=%20")),
    null,
  );
});

test("深链参数中缺少 flow_id 的 platform 回调不被视为完整 URL（避免半截 URL 被吞掉）", () => {
  const withoutFlow = extractDeepLinkUrlFromArgs(["zcode://platform/callback"]);
  const withFlow = extractDeepLinkUrlFromArgs(["zcode://platform/callback?flow_id=flow-1"]);
  assert.equal(withoutFlow, "zcode://platform/callback");
  assert.equal(withFlow, "zcode://platform/callback?flow_id=flow-1");
});
