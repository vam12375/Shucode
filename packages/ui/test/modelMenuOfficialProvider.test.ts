import assert from "node:assert/strict";
import test from "node:test";
import type { ModelSelectionView } from "@shucode/services";
import {
  MODEL_SELECT_OFFICIAL_BADGE_CLASS_NAME,
  buildRegistryModelSelectGroups,
} from "../src/lib/modelSelectionGroups.js";

const OFFICIAL_GROUP_KEY = "registry-provider:platform:gateway";

/** 最小 Registry 视图夹具：只带分组构建所需的 api/access/models 字段。 */
function makeView(providerIdsInOrder: readonly string[]): ModelSelectionView {
  return {
    revision: 1,
    providers: providerIdsInOrder.map((providerId) => ({
      providerId,
      providerName: providerId,
      config: {
        api: { type: "openai-chat-completions", baseUrl: "https://gateway.example.test/v1" },
        access: { type: "api-key", apiKey: "redacted" },
      },
      models: [{ modelId: `${providerId}-model`, config: {} }],
    })),
  } as unknown as ModelSelectionView;
}

test("官方平台 provider 固定置顶，其余分组保持 Registry 原相对顺序", () => {
  const groups = buildRegistryModelSelectGroups(
    "glm",
    makeView(["deepseek", "volc", "platform:gateway", "duck"]),
    { officialBadgeLabel: "官方" },
  );
  assert.deepEqual(
    groups.map((group) => group.key),
    [
      OFFICIAL_GROUP_KEY,
      "registry-provider:deepseek",
      "registry-provider:volc",
      "registry-provider:duck",
    ],
  );
});

test("官方平台 provider 分组带品牌色角标，本地分组不受影响", () => {
  const groups = buildRegistryModelSelectGroups("glm", makeView(["deepseek", "platform:gateway"]), {
    officialBadgeLabel: "官方",
  });
  const official = groups[0]!;
  assert.equal(official.labelBadge, "官方");
  assert.equal(official.labelBadgeClassName, MODEL_SELECT_OFFICIAL_BADGE_CLASS_NAME);
  const local = groups[1]!;
  assert.equal(local.labelBadge, undefined);
  assert.equal(local.labelBadgeClassName, undefined);
});

test("未传角标文案时不加 labelBadge，但置顶仍然生效", () => {
  const groups = buildRegistryModelSelectGroups(
    "glm",
    makeView(["deepseek", "platform:gateway"]),
    {},
  );
  assert.equal(groups[0]!.key, OFFICIAL_GROUP_KEY);
  assert.equal(groups[0]!.labelBadge, undefined);
});

test("没有官方平台 provider 时顺序保持不变", () => {
  const view = makeView(["deepseek", "volc"]);
  assert.deepEqual(
    buildRegistryModelSelectGroups("glm", view, {}).map((group) => group.key),
    ["registry-provider:deepseek", "registry-provider:volc"],
  );
});

test("官方平台 provider 已在首位时不产生多余重排", () => {
  const groups = buildRegistryModelSelectGroups("glm", makeView(["platform:gateway", "deepseek"]), {
    officialBadgeLabel: "官方",
  });
  assert.deepEqual(
    groups.map((group) => group.key),
    [OFFICIAL_GROUP_KEY, "registry-provider:deepseek"],
  );
});
