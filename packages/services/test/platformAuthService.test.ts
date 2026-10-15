import assert from "node:assert/strict";
import test from "node:test";
import type { ApiClient, PlatformLoginResult } from "@shucode/shared";
import { createPlatformAuthService } from "../src/platform/platformAuthService.js";
import {
  PLATFORM_DEVICE_TOKEN_CREDENTIAL_KEY,
  PLATFORM_SESSION_CREDENTIAL_KEY,
} from "../src/platform/platformCredentials.js";
import type { ICredentialService } from "../src/credential/credential.js";

const ORIGIN = "https://api.mendao.test";

interface FakeCredentialStore {
  service: ICredentialService;
  values: Map<string, string>;
  saveOrder: string[];
}

function createFakeCredentialService(): FakeCredentialStore {
  const values = new Map<string, string>();
  const saveOrder: string[] = [];
  return {
    values,
    saveOrder,
    service: {
      load: (key) => Promise.resolve(values.get(key) ?? null),
      save: (key, value) => {
        saveOrder.push(key);
        values.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        values.delete(key);
        return Promise.resolve();
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function initEnvelope(options: { expiresInMs?: number; pollIntervalSec?: number } = {}) {
  return {
    code: 0,
    data: {
      flow_id: "flow-1",
      authorize_url: `${ORIGIN}/app/platform/login?flow_id=flow-1`,
      expires_at: Math.floor((Date.now() + (options.expiresInMs ?? 60_000)) / 1000),
      poll_interval_sec: options.pollIntervalSec ?? 1,
    },
  };
}

function authorizedEnvelope() {
  return {
    code: 0,
    data: {
      status: "authorized",
      credentials: { token: `mdp_${"x".repeat(32)}`, token_id: "t1", token_hint: "abcd" },
      user: { id: "u1", email: "member@mendao.test", display_name: "成员" },
      teams: [{ id: "team-1", name: "演示团队", role: "member" }],
    },
  };
}

function createApiClient(handler: (url: URL, init: RequestInit | undefined) => Promise<Response>): {
  client: ApiClient;
  requests: Array<{ url: URL; init?: RequestInit }>;
} {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  return {
    requests,
    client: {
      request: (input, init) => {
        const url = input instanceof URL ? input : new URL(input.toString());
        requests.push({ url, init });
        return handler(url, init as RequestInit | undefined);
      },
    },
  };
}

function createService(options: {
  handler: (url: URL, init: RequestInit | undefined) => Promise<Response>;
  store: FakeCredentialStore;
  onSessionChanged?: () => void;
}) {
  const api = createApiClient(options.handler);
  const service = createPlatformAuthService(options.store.service, {
    apiClient: api.client,
    resolveEndpointOrigin: () => ORIGIN,
    resolveDeviceInfo: () => ({ deviceName: "测试机", platform: "darwin-arm64" }),
    ...(options.onSessionChanged ? { onSessionChanged: options.onSessionChanged } : {}),
  });
  return { service, requests: api.requests };
}

test("startLogin 携带轮询凭据请求 init，并返回 authorizeUrl", async () => {
  const store = createFakeCredentialService();
  const { service, requests } = createService({
    store,
    handler: async (url) => {
      if (url.pathname === "/api/v1/platform/auth/init") return jsonResponse(initEnvelope());
      throw new Error(`unexpected ${url.pathname}`);
    },
  });

  const started = await service.startLogin();
  assert.equal(started.flowId, "flow-1");
  assert.equal(started.authorizeUrl, `${ORIGIN}/app/platform/login?flow_id=flow-1`);
  assert.equal(started.pollIntervalMs, 1_000);

  const initRequest = requests.find(
    (request) => request.url.pathname === "/api/v1/platform/auth/init",
  );
  assert.ok(initRequest, "init 请求已发出");
  assert.match(String(initRequest.init?.headers?.Authorization ?? ""), /^Bearer [0-9a-f]{64}$/u);
  assert.deepEqual(JSON.parse(String(initRequest.init?.body)) as unknown, {
    device_name: "测试机",
    platform: "darwin-arm64",
  });
  await service.cancelLogin();
});

test("轮询 authorized：先写 device_token 再写 session，awaitLogin 返回会话", async () => {
  const store = createFakeCredentialService();
  const { service, requests } = createService({
    store,
    handler: async (url) => {
      if (url.pathname === "/api/v1/platform/auth/init") return jsonResponse(initEnvelope());
      if (url.pathname.startsWith("/api/v1/platform/auth/poll/")) {
        return jsonResponse(authorizedEnvelope());
      }
      throw new Error(`unexpected ${url.pathname}`);
    },
  });

  await service.startLogin();
  const result: PlatformLoginResult = await service.awaitLogin();
  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.session.email, "member@mendao.test");
  assert.equal(result.session.origin, ORIGIN);
  assert.equal(result.session.teams.length, 1);

  // 写入顺序：token → session（crash 只会留下孤立 token，不会出现有会话无凭据）。
  assert.deepEqual(store.saveOrder, [
    PLATFORM_DEVICE_TOKEN_CREDENTIAL_KEY,
    PLATFORM_SESSION_CREDENTIAL_KEY,
  ]);
  const session = await service.getSession();
  assert.equal(session?.userId, "u1");

  // 轮询请求必须复用 init 时同一 pollToken 的 Bearer（否则平台侧 403）。
  const initRequest = requests.find(
    (request) => request.url.pathname === "/api/v1/platform/auth/init",
  );
  const pollRequest = requests.find((request) =>
    request.url.pathname.startsWith("/api/v1/platform/auth/poll/"),
  );
  assert.ok(initRequest && pollRequest);
  assert.equal(pollRequest.init?.headers?.Authorization, initRequest.init?.headers?.Authorization);
});

test("轮询 denied：awaitLogin 返回 denied 且不写凭据", async () => {
  const store = createFakeCredentialService();
  const { service } = createService({
    store,
    handler: async (url) => {
      if (url.pathname === "/api/v1/platform/auth/init") return jsonResponse(initEnvelope());
      return jsonResponse({ code: 0, data: { status: "denied" } });
    },
  });

  await service.startLogin();
  const result = await service.awaitLogin();
  assert.deepEqual(result, { kind: "failure", reason: "denied" });
  assert.equal(store.values.size, 0);
});

test("轮询 401：不可恢复，直接按 protocol 失败", async () => {
  const store = createFakeCredentialService();
  const { service } = createService({
    store,
    handler: async (url) => {
      if (url.pathname === "/api/v1/platform/auth/init") return jsonResponse(initEnvelope());
      return jsonResponse({ code: 403, msg: "轮询凭据不匹配" }, 403);
    },
  });

  await service.startLogin();
  const result = await service.awaitLogin();
  assert.deepEqual(result, { kind: "failure", reason: "protocol" });
});

test("网络失败后按退避重试并在恢复后完成登录", async () => {
  const store = createFakeCredentialService();
  let pollAttempts = 0;
  const { service, requests } = createService({
    store,
    handler: async (url) => {
      if (url.pathname === "/api/v1/platform/auth/init") return jsonResponse(initEnvelope());
      pollAttempts += 1;
      if (pollAttempts === 1) {
        throw new Error("network down");
      }
      return jsonResponse(authorizedEnvelope());
    },
  });

  await service.startLogin();
  const result = await service.awaitLogin();
  assert.equal(result.kind, "success");
  assert.equal(pollAttempts, 2);
  const pollTimestamps = requests.filter((request) =>
    request.url.pathname.startsWith("/api/v1/platform/auth/poll/"),
  );
  assert.equal(pollTimestamps.length, 2);
});

test("超过 expiresAt 未完成：按 expired 收口", async () => {
  const store = createFakeCredentialService();
  const { service } = createService({
    store,
    handler: async (url) => {
      if (url.pathname === "/api/v1/platform/auth/init") {
        return jsonResponse(initEnvelope({ expiresInMs: 1_200 }));
      }
      return jsonResponse({ code: 0, data: { status: "pending" } });
    },
  });

  await service.startLogin();
  const result = await service.awaitLogin();
  assert.deepEqual(result, { kind: "failure", reason: "expired" });
});

test("cancelLogin：等待中的流程以 cancelled 收口，且不再发轮询", async () => {
  const store = createFakeCredentialService();
  const { service, requests } = createService({
    store,
    handler: async (url) => {
      if (url.pathname === "/api/v1/platform/auth/init") return jsonResponse(initEnvelope());
      return jsonResponse({ code: 0, data: { status: "pending" } });
    },
  });

  await service.startLogin();
  const pending = service.awaitLogin();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await service.cancelLogin();
  const result = await pending;
  assert.deepEqual(result, { kind: "failure", reason: "cancelled" });

  const pollsBefore = requests.length;
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  assert.equal(requests.length, pollsBefore, "取消后不再轮询");
});

test("logout：删除凭据并尽力移除已应用的网关 provider", async () => {
  const store = createFakeCredentialService();
  let removed = 0;
  const api = createApiClient(async (url) => {
    if (url.pathname === "/api/v1/platform/auth/init") return jsonResponse(initEnvelope());
    return jsonResponse(authorizedEnvelope());
  });
  const service = createPlatformAuthService(store.service, {
    apiClient: api.client,
    resolveEndpointOrigin: () => ORIGIN,
    removeAppliedGatewayProvider: () => {
      removed += 1;
      return Promise.resolve();
    },
  });

  await service.startLogin();
  await service.awaitLogin();
  assert.equal(store.values.size, 2);

  await service.logout();
  assert.equal(store.values.size, 0);
  assert.equal(removed, 1);
  assert.equal(await service.getSession(), null);
});

test("getSession：origin 变化时视为未登录（跨端点凭据互不可见）", async () => {
  const store = createFakeCredentialService();
  const { service } = createService({
    store,
    handler: async (url) => {
      if (url.pathname === "/api/v1/platform/auth/init") return jsonResponse(initEnvelope());
      return jsonResponse(authorizedEnvelope());
    },
  });
  await service.startLogin();
  await service.awaitLogin();

  const otherOriginService = createPlatformAuthService(store.service, {
    apiClient: createApiClient(async () => jsonResponse({})).client,
    resolveEndpointOrigin: () => "https://other.example.com",
  });
  assert.equal(await otherOriginService.getSession(), null);
});

test("onSessionChanged：登录成功与登出各触发一次，且凭据已先落盘/清除", async () => {
  const store = createFakeCredentialService();
  const notifications: Array<number> = [];
  const { service } = createService({
    store,
    onSessionChanged: () => {
      // 通知时点必须在凭据状态变化之后：登录后=2 个 key，登出后=0 个 key。
      notifications.push(store.values.size);
    },
    handler: async (url) => {
      if (url.pathname === "/api/v1/platform/auth/init") return jsonResponse(initEnvelope());
      return jsonResponse(authorizedEnvelope());
    },
  });

  await service.startLogin();
  await service.awaitLogin();
  assert.deepEqual(notifications, [2]);

  await service.logout();
  assert.deepEqual(notifications, [2, 0]);
});

test("onSessionChanged：回调抛错不影响登录/登出结果", async () => {
  const store = createFakeCredentialService();
  const { service } = createService({
    store,
    onSessionChanged: () => {
      throw new Error("broadcast failed");
    },
    handler: async (url) => {
      if (url.pathname === "/api/v1/platform/auth/init") return jsonResponse(initEnvelope());
      return jsonResponse(authorizedEnvelope());
    },
  });

  await service.startLogin();
  const result = await service.awaitLogin();
  assert.equal(result.kind, "success");
  await service.logout();
  assert.equal(await service.getSession(), null);
});
