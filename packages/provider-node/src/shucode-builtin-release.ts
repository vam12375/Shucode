import { z } from "zod";
import {
  parseShucodeBuiltinModelConfigRules,
  parseShucodeBuiltinProviderConfigRules,
  type ModelConfigRules,
  type ProviderConfigMap,
  type ProviderTemplateMap,
} from "@shucode/provider";

export const SHUCODE_BUILTIN_RELEASE_SCHEMA_VERSION = 1 as const;
const RETIRED_ZAPI_PROVIDER_ID = "builtin:zapi";

/**
 * 二开定制：官方订阅套餐 / 编程套餐 / Start Plan / 团队套餐链路已从代码与内置配置中删除。
 * 这 6 个 Built-in Account Provider 不再有对应的运行时实现（凭据解析、额度与购买入口都已移除），
 * 因此必须在这里拒绝：否则远端下发的同 schema Release 或旧的 Last-Known-Good 缓存
 * 会把它们重新带回 Registry，渲染出没有实现支撑的账号连接入口。
 *
 * 保留的 `account:zai-offpeak-idle-plan` / `account:bigmodel-offpeak-idle-plan`
 * 不属于退役名单——闲时任务仍依赖这两个隐藏节点。
 */
const RETIRED_ACCOUNT_PROVIDER_IDS: readonly string[] = Object.freeze([
  "account:zai-individual-coding-plan",
  "account:zai-team-coding-plan",
  "account:zai-start-plan",
  "account:bigmodel-individual-coding-plan",
  "account:bigmodel-team-coding-plan",
  "account:bigmodel-start-plan",
]);

export interface ShucodeBuiltinConfigContent {
  readonly providers: ProviderConfigMap;
  readonly providerTemplates: ProviderTemplateMap;
  readonly modelConfigRules: ModelConfigRules;
}

export interface ShucodeBuiltinRelease {
  readonly schemaVersion: typeof SHUCODE_BUILTIN_RELEASE_SCHEMA_VERSION;
  readonly revision: number;
  readonly config: ShucodeBuiltinConfigContent;
}

const releaseSchema = z
  .object({
    schemaVersion: z.literal(SHUCODE_BUILTIN_RELEASE_SCHEMA_VERSION),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    config: z
      .object({
        providerConfigRules: z.unknown(),
        modelConfigRules: z.unknown(),
      })
      .strict(),
  })
  .strict();

export function decodeShucodeBuiltinRelease(input: unknown): ShucodeBuiltinRelease {
  const parsed = releaseSchema.parse(input);
  const { providers, providerTemplates } = parseShucodeBuiltinProviderConfigRules(
    parsed.config.providerConfigRules,
  );
  // ZAPI 已退出产品，旧 Remote Release 或 LKG 不能在 Renderer 静态入口删除后
  // 又通过目标 Host Registry 将它重新发布。拒绝整份不兼容 Release，让 Source 回落到兼容候选。
  if (providers.has(RETIRED_ZAPI_PROVIDER_ID)) {
    throw new Error(`Shucode Built-in Release 包含已退出的 Provider: ${RETIRED_ZAPI_PROVIDER_ID}`);
  }
  // 二开定制：套餐 Account Provider 同样按退役处理（原因见 RETIRED_ACCOUNT_PROVIDER_IDS 注释）。
  for (const retiredProviderId of RETIRED_ACCOUNT_PROVIDER_IDS) {
    if (providers.has(retiredProviderId)) {
      throw new Error(`Shucode Built-in Release 包含已退出的 Provider: ${retiredProviderId}`);
    }
  }
  return Object.freeze({
    schemaVersion: SHUCODE_BUILTIN_RELEASE_SCHEMA_VERSION,
    revision: parsed.revision,
    config: Object.freeze({
      providers,
      providerTemplates,
      modelConfigRules: parseShucodeBuiltinModelConfigRules(parsed.config.modelConfigRules),
    }),
  });
}

export function encodeShucodeBuiltinRelease(release: ShucodeBuiltinRelease): object {
  return {
    schemaVersion: SHUCODE_BUILTIN_RELEASE_SCHEMA_VERSION,
    revision: release.revision,
    config: {
      providerConfigRules: {
        templateRules: release.config.providerTemplates.toJSON(),
        providerRules: release.config.providers.toJSON(),
      },
      modelConfigRules: release.config.modelConfigRules.toShucodeBuiltinJSON(),
    },
  };
}

export function serializeShucodeBuiltinRelease(release: ShucodeBuiltinRelease): string {
  return JSON.stringify(encodeShucodeBuiltinRelease(release));
}
