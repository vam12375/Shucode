import assert from "node:assert/strict";
import test from "node:test";
import type { PersonalProviderConfigRepository } from "@shucode/provider";
import { decodeProviderConfigFile } from "@shucode/provider-node";
import {
  providerProvisioningEnvelopeSchema,
  type ProviderProvisioningEnvelope,
} from "@shucode/shared";
import {
  createPlatformUserConfigApplier,
  mergePlatformUserConfigIntoPersonalConfig,
} from "../src/platform/platformUserConfigApply.js";

const PLATFORM_ID = "platform:gateway";
const PLATFORM_TOKEN = `mdp_${"x".repeat(32)}`;

function platformProviderRule(modelIds: string[], token = PLATFORM_TOKEN) {
  return {
    providerId: PLATFORM_ID,
    providerName: "Mendao Platform",
    enabled: true,
    config: {
      group: "standard-personal",
      access: { type: "api-key", apiKey: token },
      api: { type: "anthropic-messages", baseUrl: "http://localhost:8788" },
      personalModelIds: modelIds,
      modelOrder: modelIds,
      visibility: "visible",
    },
  };
}

function platformModelRules(modelIds: string[]) {
  return modelIds.map((modelId) => ({
    providerId: PLATFORM_ID,
    modelId,
    config: { enabled: true },
  }));
}

function envelope(options: {
  providerRules: unknown[];
  providerModelRules?: unknown[];
  providerOrder?: string[];
  defaultModelSelection?: { providerId: string; modelId: string };
}): ProviderProvisioningEnvelope {
  return providerProvisioningEnvelopeSchema.parse({
    schemaVersion: 1,
    syncId: "ucfg_test",
    personalConfig: {
      providerConfigRules: { providerRules: options.providerRules },
      modelConfigRules: {
        providerModelRules: options.providerModelRules ?? [],
        manualProviderModelRules: [],
      },
      ...(options.providerOrder ? { providerOrder: options.providerOrder } : {}),
      ...(options.defaultModelSelection
        ? { defaultModelSelection: options.defaultModelSelection }
        : {}),
    },
    accountSettings: { providerFamilyDomain: null, providerFamilyConnectionSelections: {} },
    credentials: [],
  });
}

/** 用正式 codec 构造 personal 层状态，避免测试自建字段清单。 */
function buildLayer(config: {
  providerRules: unknown[];
  providerModelRules?: unknown[];
  manualProviderModelRules?: unknown[];
  providerOrder?: string[];
  defaultModelSelection?: { providerId: string; modelId: string };
}) {
  return decodeProviderConfigFile({
    schemaVersion: 1,
    config: {
      providerConfigRules: { providerRules: config.providerRules },
      modelConfigRules: {
        providerModelRules: config.providerModelRules ?? [],
        manualProviderModelRules: config.manualProviderModelRules ?? [],
      },
      ...(config.providerOrder ? { providerOrder: config.providerOrder } : {}),
      ...(config.defaultModelSelection
        ? { defaultModelSelection: config.defaultModelSelection }
        : {}),
    },
  });
}

function localProviderRule(providerId: string, modelIds: string[]) {
  return {
    providerId,
    providerName: "本地供应商",
    config: {
      access: { type: "api-key", apiKey: "sk-local" },
      api: { type: "openai-chat-completions", baseUrl: "https://api.deepseek.com/v1" },
      personalModelIds: modelIds,
      modelOrder: modelIds,
    },
  };
}

function createFakeRepository(initial: ReturnType<typeof buildLayer>) {
  let revision = 0;
  let state = { ...initial, revision: `rev-${revision}` };
  const repository: PersonalProviderConfigRepository = {
    read: () => Promise.resolve(state),
    update: (transform) => {
      revision += 1;
      const next = transform(state);
      state = { ...next, revision: `rev-${revision}` };
      return Promise.resolve(state);
    },
    onDidChange: () => () => {},
  };
  return { repository, readState: () => state };
}

test("merge：平台 provider 覆盖写入，本地 provider 与顺序保留", () => {
  const current = buildLayer({
    providerRules: [localProviderRule("new-provider", ["deepseek-flash"])],
    providerModelRules: [
      { providerId: "new-provider", modelId: "deepseek-flash", config: { enabled: true } },
    ],
    providerOrder: ["new-provider"],
    defaultModelSelection: { providerId: "new-provider", modelId: "deepseek-flash" },
  });
  const incoming = buildLayer({
    providerRules: [platformProviderRule(["deepseek-v4.1-flash", "grok-4.7"])],
    providerModelRules: platformModelRules(["deepseek-v4.1-flash", "grok-4.7"]),
    providerOrder: [PLATFORM_ID],
  });

  const merged = mergePlatformUserConfigIntoPersonalConfig(current, incoming);

  assert.deepEqual(merged.providers.keys().sort(), ["new-provider", PLATFORM_ID]);
  assert.deepEqual(merged.providerOrder, ["new-provider", PLATFORM_ID]);
  // 默认模型不被信封覆盖（云端偏好走服务层补档位链路）。
  assert.deepEqual(merged.defaultModelSelection, {
    providerId: "new-provider",
    modelId: "deepseek-flash",
  });
  const modelJson = merged.models.toPersonalJSON();
  assert.deepEqual(
    modelJson.providerModelRules
      .map((rule) => `${rule.providerId}/${rule.modelId}`)
      .sort(),
    ["new-provider/deepseek-flash", `${PLATFORM_ID}/deepseek-v4.1-flash`, `${PLATFORM_ID}/grok-4.7`].sort(),
  );
});

test("merge：平台 provider 已存在时按 incoming 收敛模型列表，其它 provider 的模型规则不动", () => {
  const current = buildLayer({
    providerRules: [
      localProviderRule("new-provider", ["deepseek-flash"]),
      platformProviderRule(["旧模型-应被移除", "grok-4.7"], "mdp_old_token_000000000000000000"),
    ],
    providerModelRules: [
      { providerId: "new-provider", modelId: "deepseek-flash", config: { enabled: true } },
      { providerId: PLATFORM_ID, modelId: "旧模型-应被移除", config: { enabled: true } },
      { providerId: PLATFORM_ID, modelId: "grok-4.7", config: { enabled: true } },
    ],
    providerOrder: ["new-provider", PLATFORM_ID],
  });
  const incoming = buildLayer({
    providerRules: [platformProviderRule(["grok-4.7", "qwen3.8-27b"])],
    providerModelRules: platformModelRules(["grok-4.7", "qwen3.8-27b"]),
    providerOrder: [PLATFORM_ID],
  });

  const merged = mergePlatformUserConfigIntoPersonalConfig(current, incoming);

  const platformRule = merged.providers.getRule(PLATFORM_ID);
  assert.deepEqual(platformRule?.config.personalModelIds, ["grok-4.7", "qwen3.8-27b"]);
  // token 按 incoming 更新（凭据轮换跟随信封）。
  assert.equal(platformRule?.config.access?.apiKey, PLATFORM_TOKEN);
  const modelKeys = merged.models
    .toPersonalJSON()
    .providerModelRules.map((rule) => `${rule.providerId}/${rule.modelId}`)
    .sort();
  assert.deepEqual(modelKeys, [
    "new-provider/deepseek-flash",
    `${PLATFORM_ID}/grok-4.7`,
    `${PLATFORM_ID}/qwen3.8-27b`,
  ].sort());
});

test("applier：首次合并 → applied；内容不变 → already-applied；本地 provider 始终保留", async () => {
  const initial = buildLayer({
    providerRules: [localProviderRule("new-provider", ["deepseek-flash"])],
    providerModelRules: [
      { providerId: "new-provider", modelId: "deepseek-flash", config: { enabled: true } },
    ],
    providerOrder: ["new-provider"],
  });
  const { repository, readState } = createFakeRepository(initial);
  let deleted = 0;
  const apply = createPlatformUserConfigApplier({
    personalRepository: repository,
    deletePlatformProvider: () => {
      deleted += 1;
      return Promise.resolve();
    },
    refreshRegistry: () => Promise.resolve(),
  });

  const first = await apply(
    envelope({
      providerRules: [platformProviderRule(["deepseek-v4.1-flash"])],
      providerModelRules: platformModelRules(["deepseek-v4.1-flash"]),
      providerOrder: [PLATFORM_ID],
    }),
  );
  assert.equal(first.status, "applied");
  assert.deepEqual(readState().providers.keys().sort(), ["new-provider", PLATFORM_ID]);

  const second = await apply(
    envelope({
      providerRules: [platformProviderRule(["deepseek-v4.1-flash"])],
      providerModelRules: platformModelRules(["deepseek-v4.1-flash"]),
      providerOrder: [PLATFORM_ID],
    }),
  );
  assert.equal(second.status, "already-applied");
  assert.equal(deleted, 0);
});

test("applier：信封无平台 provider（未加入团队）→ 删除该 provider 并报 applied", async () => {
  const initial = buildLayer({
    providerRules: [
      localProviderRule("new-provider", ["deepseek-flash"]),
      platformProviderRule(["deepseek-v4.1-flash"]),
    ],
    providerModelRules: platformModelRules(["deepseek-v4.1-flash"]),
    providerOrder: ["new-provider", PLATFORM_ID],
  });
  const { repository } = createFakeRepository(initial);
  let deleted = 0;
  const apply = createPlatformUserConfigApplier({
    personalRepository: repository,
    deletePlatformProvider: () => {
      deleted += 1;
      return Promise.resolve();
    },
    refreshRegistry: () => Promise.resolve(),
  });

  const result = await apply(envelope({ providerRules: [] }));
  assert.equal(result.status, "applied");
  assert.equal(deleted, 1);
});

test("applier：平台 provider 存在但模型列表为空 → 同样按删除处理", async () => {
  const { repository } = createFakeRepository(buildLayer({ providerRules: [] }));
  let deleted = 0;
  const apply = createPlatformUserConfigApplier({
    personalRepository: repository,
    deletePlatformProvider: () => {
      deleted += 1;
      return Promise.resolve();
    },
    refreshRegistry: () => Promise.resolve(),
  });

  const result = await apply(
    envelope({ providerRules: [platformProviderRule([])], providerOrder: [PLATFORM_ID] }),
  );
  assert.equal(result.status, "applied");
  assert.equal(deleted, 1);
});
