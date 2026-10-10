import assert from "node:assert/strict";
import test from "node:test";
import { listProviderModels } from "../src/shucode-protocol/provider-model-listing.js";
import { ProviderModelListingError } from "../src/shucode-protocol/provider-model-list.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function recordFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  calls: Array<{ url: string; method?: string; headers: Record<string, string> }>;
  fetch: typeof globalThis.fetch;
} {
  const calls: Array<{ url: string; method?: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      ...(init?.method === undefined ? {} : { method: init.method }),
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
    });
    return handler(url, init);
  }) as typeof globalThis.fetch;
  return { calls, fetch: fetchImpl };
}

test("命中第一个候选时只发一次 GET，并带上按 API 格式选的鉴权头", async () => {
  const recorder = recordFetch(() => jsonResponse({ data: [{ id: "b" }, { id: "a" }] }));
  const result = await listProviderModels(
    {
      apiFormat: "anthropic-messages",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
    },
    { fetch: recorder.fetch },
  );

  assert.deepEqual(result, {
    endpoint: "https://api.example.com/v1/models",
    models: ["a", "b"],
  });
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0]?.method, "GET");
  assert.equal(recorder.calls[0]?.headers["x-api-key"], "sk-test");
});

test("404 继续试下一个候选，直到某个候选返回模型列表", async () => {
  const recorder = recordFetch((url) =>
    url === "https://api.deepseek.com/models"
      ? jsonResponse({ data: [{ id: "deepseek-chat" }] })
      : jsonResponse({ error: "not found" }, 404),
  );
  const result = await listProviderModels(
    { apiFormat: "anthropic-messages", baseUrl: "https://api.deepseek.com/anthropic" },
    { fetch: recorder.fetch },
  );

  assert.deepEqual(
    recorder.calls.map((call) => call.url),
    [
      "https://api.deepseek.com/anthropic/v1/models",
      "https://api.deepseek.com/anthropic/models",
      "https://api.deepseek.com/v1/models",
      "https://api.deepseek.com/models",
    ],
  );
  assert.equal(result.endpoint, "https://api.deepseek.com/models");
  assert.deepEqual(result.models, ["deepseek-chat"]);
});

test("401 立即失败，不再尝试其它候选", async () => {
  const recorder = recordFetch(() => jsonResponse({ error: "unauthorized" }, 401));
  await assert.rejects(
    () =>
      listProviderModels(
        { apiFormat: "openai-responses", baseUrl: "https://api.deepseek.com/anthropic" },
        { fetch: recorder.fetch },
      ),
    (error: unknown) =>
      error instanceof ProviderModelListingError &&
      error.kind === "unauthorized" &&
      error.status === 401,
  );
  assert.equal(recorder.calls.length, 1);
});

test("全部候选都不存在时报 endpoint-not-found", async () => {
  const recorder = recordFetch(() => jsonResponse({ error: "not found" }, 404));
  await assert.rejects(
    () =>
      listProviderModels(
        { apiFormat: "openai-responses", baseUrl: "https://api.example.com" },
        { fetch: recorder.fetch },
      ),
    (error: unknown) =>
      error instanceof ProviderModelListingError && error.kind === "endpoint-not-found",
  );
  // /v1/models 与 /models 两个候选都被尝试过。
  assert.equal(recorder.calls.length, 2);
});

test("请求超时归类为 network，并保留可读原因", async () => {
  const hangingFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    })) as typeof globalThis.fetch;

  await assert.rejects(
    () =>
      listProviderModels(
        { apiFormat: "openai-responses", baseUrl: "https://api.example.com" },
        { fetch: hangingFetch, timeoutMs: 5 },
      ),
    (error: unknown) =>
      error instanceof ProviderModelListingError &&
      error.kind === "network" &&
      /timed out/.test(error.message),
  );
});

test("非 JSON 响应归类为 invalid-response", async () => {
  const recorder = recordFetch(() => new Response("<html>nope</html>", { status: 200 }));
  await assert.rejects(
    () =>
      listProviderModels(
        { apiFormat: "openai-responses", baseUrl: "https://api.example.com" },
        { fetch: recorder.fetch },
      ),
    (error: unknown) =>
      error instanceof ProviderModelListingError && error.kind === "invalid-response",
  );
});
