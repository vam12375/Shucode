import assert from "node:assert/strict";
import test from "node:test";
import type { ApiClient, ModelSelection, ProviderProvisioningEnvelope } from "@shucode/shared";
import { createPlatformUserConfigService } from "../src/platform/platformUserConfigService.js";
import {
  PLATFORM_DEVICE_TOKEN_CREDENTIAL_KEY,
  PLATFORM_SESSION_CREDENTIAL_KEY,
} from "../src/platform/platformCredentials.js";
import type { ICredentialService } from "../src/credential/credential.js";

const ORIGIN = "https://api.mendao.test";
const DEVICE_TOKEN = `mdp_${"x".repeat(32)}`;

function createFakeCredentialService(): {
  service: ICredentialService;
  values: Map<string, string>;
} {
  const values = new Map<string, string>([
    [PLATFORM_DEVICE_TOKEN_CREDENTIAL_KEY, DEVICE_TOKEN],
    [
      PLATFORM_SESSION_CREDENTIAL_KEY,
      JSON.stringify({
        userId: "u1",
        email: "member@mendao.test",
        displayName: "成员",
        teams: [{ id: "team-1", name: "演示团队", role: "member" }],
        origin: ORIGIN,
        deviceTokenHint: "abcd",
        loginAt: new Date().toISOString(),
      }),
    ],
  ]);
  return {
    values,
    service: {
      load: (key) => Promise.resolve(values.get(key) ?? null),
      save: (key, value) => {
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

function envelopeFixture(
  overrides: Partial<ProviderProvisioningEnvelope["accountSettings"]> = {},
): ProviderProvisioningEnvelope {
  return {
    schemaVersion: 1,
    syncId: "ucfg_test",
    personalConfig: {
      providerConfigRules: {
        providerRules: [
          {
            providerId: "platform:gateway",
            providerName: "Mendao Platform",
            enabled: true,
            config: {
              group: "standard-personal",
              access: { type: "api-key" },
              api: { type: "anthropic-messages", baseUrl: "https://gw.mendao.test" },
              personalModelIds: ["claude-sonnet-4-5"],
              modelOrder: ["claude-sonnet-4-5"],
              visibility: "visible",
            },
          },
        ],
      },
      modelConfigRules: {
        providerModelRules: [
          {
            providerId: "platform:gateway",
            modelId: "claude-sonnet-4-5",
            config: { enabled: true },
          },
        ],
        manualProviderModelRules: [],
      },
      providerOrder: ["platform:gateway"],
      defaultModelSelection: { providerId: "platform:gateway", modelId: "claude-sonnet-4-5" },
    },
    accountSettings: {
      providerFamilyDomain: null,
      providerFamilyConnectionSelections: {},
      ...overrides,
    },
    credentials: [
      {
        scope: "account-provider",
        key: "account-provider:platform:gateway:api-key",
        value: DEVICE_TOKEN,
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
        requests.push({ url, init: init as RequestInit | undefined });
        return handler(url, init as RequestInit | undefined);
      },
    },
  };
}

function createService(options: {
  handler: (url: URL, init: RequestInit | undefined) => Promise<Response>;
  store?: ReturnType<typeof createFakeCredentialService>;
  applyEnvelope?: (envelope: ProviderProvisioningEnvelope) => Promise<{
    syncId: string;
    status: "applied" | "already-applied" | "failed";
    personalProviderCount: number;
    credentialCount: number;
    rolledBack: boolean;
  }>;
  currentSettings?: {
    providerFamilyDomain?: "zai" | "bigmodel";
    providerFamilyConnectionSelections?: { zai?: { kind: "start-plan" } };
  };
  /** 提供任一默认模型回调即启用补齐链路（未提供时服务不注入回调，语义为"无补齐能力"）。 */
  completeDefault?: (selection: ModelSelection) => ModelSelection | undefined;
  saveDefault?: (selection: ModelSelection | undefined) => Promise<void>;
}) {
  const store = options.store ?? createFakeCredentialService();
  const api = createApiClient(options.handler);
  const applied: ProviderProvisioningEnvelope[] = [];
  const savedDefaults: ModelSelection[] = [];
  const service = createPlatformUserConfigService(store.service, {
    apiClient: api.client,
    resolveEndpointOrigin: () => ORIGIN,
    applyEnvelope:
      options.applyEnvelope ??
      ((envelope) => {
        applied.push(envelope);
        return Promise.resolve({
          syncId: envelope.syncId,
          status: "applied" as const,
          personalProviderCount: 1,
          credentialCount: envelope.credentials.length,
          rolledBack: false,
        });
      }),
    getCurrentAccountSettings: () => Promise.resolve(options.currentSettings ?? {}),
    ...(options.completeDefault !== undefined || options.saveDefault !== undefined
      ? {
          resolveCompletedDefaultSelection:
            options.completeDefault ?? (() => undefined),
          saveConfiguredDefault:
            options.saveDefault ??
            ((selection) => {
              if (selection) savedDefaults.push(selection);
              return Promise.resolve();
            }),
        }
      : {}),
  });
  return { service, requests: api.requests, applied, store, savedDefaults };
}

test("无凭据：skipped no-credential 且不发请求", async () => {
  let called = 0;
  const emptyStore = createFakeCredentialService();
  emptyStore.values.clear();
  const service = createPlatformUserConfigService(emptyStore.service, {
    apiClient: createApiClient(async () => {
      called += 1;
      return jsonResponse({});
    }).client,
    resolveEndpointOrigin: () => ORIGIN,
    applyEnvelope: async () => {
      throw new Error("不应调用");
    },
    getCurrentAccountSettings: async () => ({}),
  });

  const result = await service.refresh();
  assert.deepEqual(result, { kind: "skipped", reason: "no-credential" });
  assert.equal(called, 0);
});

test("成功：拉取信封 → 剥离偏好默认 → 归一 accountSettings → 应用，返回 applied", async () => {
  const { service, requests, applied } = createService({
    handler: async () => jsonResponse({ code: 0, data: { envelope: envelopeFixture() } }),
    currentSettings: {
      providerFamilyDomain: "zai",
      providerFamilyConnectionSelections: { zai: { kind: "start-plan" } },
    },
  });

  const result = await service.refresh();
  assert.deepEqual(result, { kind: "applied" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url.pathname, "/api/v1/client/user-config");
  assert.equal(requests[0]?.init?.headers?.Authorization, `Bearer ${DEVICE_TOKEN}`);

  // 云端空值不覆写本地：domain=null / selections={} → 沿用本地当前值。
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0]?.accountSettings, {
    providerFamilyDomain: "zai",
    providerFamilyConnectionSelections: { zai: { kind: "start-plan" } },
  });
  // 云端偏好默认被剥离：Registry 完整校验要求档位，远端信封不能直接携带未补全的选择，
  // 否则会触发整份回滚（见 platformUserConfigService 注释）。
  assert.equal(applied[0]?.personalConfig.defaultModelSelection, undefined);
  const status = service.getStatus();
  assert.equal(status.lastResult?.kind, "applied");
  assert.ok(status.lastSyncAt);
});

test("偏好默认：应用成功后补档位并写入（写回值来自补齐回调）", async () => {
  const { service, applied, savedDefaults } = createService({
    handler: async () => jsonResponse({ code: 0, data: { envelope: envelopeFixture() } }),
    completeDefault: (selection) => ({
      providerId: selection.providerId,
      modelId: selection.modelId,
      options: { reasoningLevel: "max" },
    }),
  });

  const result = await service.refresh();
  assert.deepEqual(result, { kind: "applied" });
  assert.equal(applied.length, 1);
  assert.deepEqual(savedDefaults, [
    {
      providerId: "platform:gateway",
      modelId: "claude-sonnet-4-5",
      options: { reasoningLevel: "max" },
    },
  ]);
});

test("偏好默认：补齐回调返回 undefined（无档位/模型缺失）时跳过写回，仍 applied", async () => {
  const { service, savedDefaults } = createService({
    handler: async () => jsonResponse({ code: 0, data: { envelope: envelopeFixture() } }),
    completeDefault: () => undefined,
  });

  const result = await service.refresh();
  assert.deepEqual(result, { kind: "applied" });
  assert.equal(savedDefaults.length, 0);
});

test("偏好默认：无补齐回调时剥离但仍 applied（不因默认选择让整次同步失败）", async () => {
  const { service, savedDefaults } = createService({
    handler: async () => jsonResponse({ code: 0, data: { envelope: envelopeFixture() } }),
    // 未提供 completeDefault/saveDefault → 服务不带补齐链路。
  });

  const result = await service.refresh();
  assert.deepEqual(result, { kind: "applied" });
  assert.equal(savedDefaults.length, 0);
});

test("偏好默认：写回抛错不影响应用结果（只告警）", async () => {
  const { service } = createService({
    handler: async () => jsonResponse({ code: 0, data: { envelope: envelopeFixture() } }),
    completeDefault: (selection) => ({
      providerId: selection.providerId,
      modelId: selection.modelId,
      options: { reasoningLevel: "max" },
    }),
    saveDefault: async () => {
      throw new Error("disk full");
    },
  });

  const result = await service.refresh();
  assert.deepEqual(result, { kind: "applied" });
});

test("云端 accountSettings 非空值时生效", async () => {
  const { service, applied } = createService({
    handler: async () =>
      jsonResponse({
        code: 0,
        data: { envelope: envelopeFixture({ providerFamilyDomain: "bigmodel" }) },
      }),
    currentSettings: { providerFamilyDomain: "zai" },
  });
  await service.refresh();
  assert.equal(applied[0]?.accountSettings.providerFamilyDomain, "bigmodel");
});

test("401：清除本机平台凭据，返回 unauthorized", async () => {
  const store = createFakeCredentialService();
  const { service } = createService({
    store,
    handler: async () => jsonResponse({ code: 401, msg: "凭据无效或已吊销" }, 401),
  });

  const result = await service.refresh();
  assert.deepEqual(result, { kind: "failed", message: "unauthorized", unauthorized: true });
  assert.equal(store.values.size, 0);

  // 凭据已清除：后续刷新直接 skipped，不再打服务器。
  const second = await service.refresh();
  assert.deepEqual(second, { kind: "skipped", reason: "no-credential" });
});

test("响应信封不合法：failed invalid_response，不进入应用", async () => {
  const { service, applied } = createService({
    handler: async () => jsonResponse({ code: 0, data: { envelope: { nope: true } } }),
  });
  const result = await service.refresh();
  assert.equal(result.kind, "failed");
  assert.equal(applied.length, 0);
});

test("应用失败：failed 保留旧配置（不抛错）", async () => {
  const { service } = createService({
    handler: async () => jsonResponse({ code: 0, data: { envelope: envelopeFixture() } }),
    applyEnvelope: async (envelope) =>
      ({
        syncId: envelope.syncId,
        status: "failed",
        personalProviderCount: 0,
        credentialCount: 0,
        errorMessage: "CAS 冲突",
        rolledBack: true,
      }) as never,
  });
  const result = await service.refresh();
  assert.equal(result.kind, "failed");
  if (result.kind === "failed") {
    assert.equal(result.message, "CAS 冲突");
  }
});

test("单飞：并发 refresh 第二个返回 in-flight", async () => {
  let releaseApply: (() => void) | null = null;
  const { service } = createService({
    handler: async () => jsonResponse({ code: 0, data: { envelope: envelopeFixture() } }),
    applyEnvelope: (envelope) =>
      new Promise((resolve) => {
        releaseApply = () =>
          resolve({
            syncId: envelope.syncId,
            status: "applied",
            personalProviderCount: 1,
            credentialCount: 1,
            rolledBack: false,
          });
      }),
  });

  const first = service.refresh();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await service.refresh();
  assert.deepEqual(second, { kind: "skipped", reason: "in-flight" });
  releaseApply?.();
  assert.deepEqual(await first, { kind: "applied" });
});
