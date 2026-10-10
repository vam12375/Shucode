import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { listProviderModels } from "../src/shucode-protocol/provider-model-listing.js";

interface RecordedRequest {
  method?: string;
  url?: string;
  headers: NodeJS.Dict<string | string[]>;
}

async function withServer(
  handler: (request: RecordedRequest, response: ServerResponse) => void,
  run: (baseUrl: string, requests: RecordedRequest[]) => Promise<void>,
): Promise<void> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const recorded: RecordedRequest = {
      method: request.method,
      url: request.url,
      headers: request.headers,
    };
    requests.push(recorded);
    handler(recorded, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`, requests);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("真实 HTTP：404 的候选被跳过，命中的候选带鉴权头且结果被解析", async () => {
  await withServer(
    (request, response) => {
      if (request.url === "/v1/models") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ slug: "z-model" }, { slug: "a-model" }] }));
    },
    async (baseUrl, requests) => {
      const result = await listProviderModels({
        apiFormat: "openai-responses",
        baseUrl,
        apiKey: "sk-test",
      });

      assert.deepEqual(result, {
        endpoint: `${baseUrl}/models`,
        models: ["a-model", "z-model"],
      });
      assert.deepEqual(
        requests.map((request) => `${request.method} ${request.url}`),
        ["GET /v1/models", "GET /models"],
      );
      assert.equal(requests[0]?.headers.authorization, "Bearer sk-test");
      assert.equal(requests[0]?.headers.accept, "application/json");
    },
  );
});

test("真实 HTTP：anthropic-messages 使用 x-api-key，且自定义头随请求发出", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "claude-opus-4-8" }] }));
    },
    async (baseUrl, requests) => {
      const result = await listProviderModels({
        apiFormat: "anthropic-messages",
        baseUrl,
        apiKey: "sk-anthropic",
        headers: { "X-Provider-Tenant": "team-a" },
      });

      assert.equal(result.endpoint, `${baseUrl}/v1/models`);
      assert.deepEqual(result.models, ["claude-opus-4-8"]);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.headers["x-api-key"], "sk-anthropic");
      assert.equal(requests[0]?.headers.authorization, undefined);
      assert.equal(requests[0]?.headers["x-provider-tenant"], "team-a");
    },
  );
});

test("真实 HTTP：401 不重试其它候选", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "unauthorized" } }));
    },
    async (baseUrl, requests) => {
      await assert.rejects(
        () =>
          listProviderModels({
            apiFormat: "openai-responses",
            baseUrl: `${baseUrl}/anthropic`,
            apiKey: "sk-bad",
          }),
        /HTTP 401/,
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.url, "/anthropic/v1/models");
    },
  );
});

test("真实 HTTP：全部候选 404 时报端点不存在", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(404);
      response.end();
    },
    async (baseUrl, requests) => {
      await assert.rejects(
        () => listProviderModels({ apiFormat: "openai-responses", baseUrl }),
        /HTTP 404/,
      );
      // /v1/models 与 /models 两个候选都被尝试过。
      assert.equal(requests.length, 2);
    },
  );
});
