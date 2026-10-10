import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_LIST_RETRYABLE_STATUS,
  ProviderModelListingError,
  buildProviderModelListCandidates,
  buildProviderModelListHeaders,
  classifyModelListStatus,
  parseProviderModelList,
} from "../src/shucode-protocol/provider-model-list.js";

test("候选端点：普通 base URL 先试 /v1/models，再用 /models 兜底", () => {
  assert.deepEqual(buildProviderModelListCandidates("https://api.example.com"), [
    "https://api.example.com/v1/models",
    "https://api.example.com/models",
  ]);
  assert.deepEqual(buildProviderModelListCandidates("https://api.example.com/gateway"), [
    "https://api.example.com/gateway/v1/models",
    "https://api.example.com/gateway/models",
  ]);
});

test("候选端点：base 已带版本段时先试 {base}/models", () => {
  // base 正好是 /v1：不再拼 /v1/v1/models。
  assert.deepEqual(buildProviderModelListCandidates("https://api.example.com/v1"), [
    "https://api.example.com/v1/models",
  ]);
  // 智谱式多段版本路径：先试自身，再补一遍 /v1 兜底。
  assert.deepEqual(buildProviderModelListCandidates("https://api.example.com/api/coding/paas/v4"), [
    "https://api.example.com/api/coding/paas/v4/models",
    "https://api.example.com/api/coding/paas/v4/v1/models",
  ]);
});

test("候选端点：Anthropic 兼容后缀会剥掉后再试根端点", () => {
  assert.deepEqual(buildProviderModelListCandidates("https://api.deepseek.com/anthropic"), [
    "https://api.deepseek.com/anthropic/v1/models",
    "https://api.deepseek.com/anthropic/models",
    "https://api.deepseek.com/v1/models",
    "https://api.deepseek.com/models",
  ]);
  // 兼容后缀必须落在完整路径段边界上：`…/anthropic/v1` 的末段是版本段而不是 `/anthropic`，
  // 因此不会剥出根路径去猜测 `/models`。
  assert.deepEqual(buildProviderModelListCandidates("https://api.deepseek.com/anthropic/v1"), [
    "https://api.deepseek.com/anthropic/v1/models",
  ]);
  // `/api/anthropic` 命中的是最长的 `/api/anthropic` 后缀，剥掉后回落到站点根。
  assert.deepEqual(buildProviderModelListCandidates("https://api.example.com/api/anthropic"), [
    "https://api.example.com/api/anthropic/v1/models",
    "https://api.example.com/api/anthropic/models",
    "https://api.example.com/v1/models",
    "https://api.example.com/models",
  ]);
  // 前缀相近但不是完整路径段的地址不应被当成兼容后缀。
  assert.deepEqual(buildProviderModelListCandidates("https://api.example.com/anthropic-proxy"), [
    "https://api.example.com/anthropic-proxy/v1/models",
    "https://api.example.com/anthropic-proxy/models",
  ]);
});

test("候选端点：结尾斜杠不影响派生结果", () => {
  assert.deepEqual(buildProviderModelListCandidates("https://api.example.com/v1/"), [
    "https://api.example.com/v1/models",
  ]);
});

test("候选端点：非 http(s) 或空地址按连接配置错误拒绝", () => {
  for (const input of ["", "   ", "not-a-url", "ftp://api.example.com"]) {
    assert.throws(
      () => buildProviderModelListCandidates(input),
      (error: unknown) =>
        error instanceof ProviderModelListingError && error.kind === "invalid-connection",
      `expected invalid-connection for ${JSON.stringify(input)}`,
    );
  }
});

test("鉴权头：anthropic-messages 用 x-api-key，OpenAI 兼容用 Bearer", () => {
  assert.deepEqual(
    buildProviderModelListHeaders({ apiFormat: "anthropic-messages", apiKey: "  sk-test  " }),
    { Accept: "application/json", "x-api-key": "sk-test" },
  );
  assert.deepEqual(
    buildProviderModelListHeaders({ apiFormat: "openai-chat-completions", apiKey: "sk-test" }),
    { Accept: "application/json", Authorization: "Bearer sk-test" },
  );
  assert.deepEqual(
    buildProviderModelListHeaders({ apiFormat: "openai-responses", apiKey: "sk-test" }),
    { Accept: "application/json", Authorization: "Bearer sk-test" },
  );
});

test("鉴权头：没有 Key 时不发鉴权头；自定义头不得覆盖鉴权头", () => {
  assert.deepEqual(buildProviderModelListHeaders({ apiFormat: "openai-responses" }), {
    Accept: "application/json",
  });
  assert.deepEqual(
    buildProviderModelListHeaders({
      apiFormat: "anthropic-messages",
      apiKey: "sk-test",
      headers: {
        Authorization: "Bearer attacker",
        "x-api-key": "attacker",
        "X-Custom": "kept",
      },
    }),
    { Accept: "application/json", "x-api-key": "sk-test", "X-Custom": "kept" },
  );
});

test("鉴权头：含换行或非法的自定义头被拒绝", () => {
  for (const headers of [{ "X-Bad": "line1\r\nX-Injected: 1" }, { "X-Bad\n": "value" }]) {
    assert.throws(
      () => buildProviderModelListHeaders({ apiFormat: "openai-responses", headers }),
      (error: unknown) =>
        error instanceof ProviderModelListingError && error.kind === "invalid-connection",
    );
  }
});

test("解析响应：OpenAI / Anthropic 的 {data:[{id}]}", () => {
  assert.deepEqual(
    parseProviderModelList({
      data: [{ id: "gpt-5" }, { id: "gpt-4.1" }, { id: "claude-opus-4-8" }],
    }),
    ["claude-opus-4-8", "gpt-4.1", "gpt-5"],
  );
});

test("解析响应：OpenAI Responses 兼容的 {models:[{slug}]}，slug 优先于 id", () => {
  assert.deepEqual(
    parseProviderModelList({
      models: [{ slug: "glm-4.7", id: "ignored" }, { id: "glm-4.5" }, "glm-4.0"],
    }),
    ["glm-4.0", "glm-4.5", "glm-4.7"],
  );
});

test("解析响应：data 为数组时忽略同级的 models 形状", () => {
  assert.deepEqual(parseProviderModelList({ data: [{ id: "a" }], models: "unexpected" }), ["a"]);
});

test("解析响应：顶层数组、去重与升序排序", () => {
  assert.deepEqual(parseProviderModelList(["b", "a", "b", "  c  "]), ["a", "b", "c"]);
  assert.deepEqual(parseProviderModelList({ data: [] }), []);
});

test("解析响应：无法识别的结构报 invalid-response，而不是谎报没有模型", () => {
  for (const payload of [42, "text", { data: "unexpected" }, { models: 7 }]) {
    assert.throws(
      () => parseProviderModelList(payload),
      (error: unknown) =>
        error instanceof ProviderModelListingError && error.kind === "invalid-response",
      `expected invalid-response for ${JSON.stringify(payload)}`,
    );
  }
});

test("HTTP 状态分类：只有 404/405 可以继续尝试下一个候选", () => {
  assert.equal(classifyModelListStatus(401), "unauthorized");
  assert.equal(classifyModelListStatus(403), "unauthorized");
  assert.equal(classifyModelListStatus(404), "endpoint-not-found");
  assert.equal(classifyModelListStatus(405), "endpoint-not-found");
  assert.equal(classifyModelListStatus(429), "http-error");
  assert.equal(classifyModelListStatus(500), "http-error");

  assert.deepEqual([...MODEL_LIST_RETRYABLE_STATUS].sort(), [404, 405]);
});
