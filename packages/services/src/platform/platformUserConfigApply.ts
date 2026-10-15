/**
 * 平台用户级配置的应用语义：合并（upsert）而不是整份替换。
 *
 * 背景：首版直接复用 SSH/WSL 的 Provider Provisioning 目标（replace 语义，
 * 目标环境以来源配置为准），但平台只拥有 `platform:gateway` 一个 provider，
 * 整份替换会把用户本地自建的供应商、模型与顺序全部覆盖掉。
 *
 * 本模块是平台信封写入 personal 层的唯一路径（经 PersonalProviderConfigRepository）：
 * - merge：incoming 覆盖同名 provider/模型，其它本地内容原样保留；
 * - removal：信封中平台 provider 缺失或其模型列表为空 → 删除该 provider；
 * - 变更检测：结果与原状态一致时报 already-applied（避免周期同步反复重写偏好默认）。
 */
import {
  parsePersonalModelConfigRules,
  type ModelConfigRules,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
  type PersonalProviderConfigRepository,
} from "@shucode/provider";
import {
  PLATFORM_GATEWAY_PROVIDER_ID,
  type ProviderProvisioningEnvelope,
  type ProviderProvisioningResult,
} from "@shucode/shared";
import { decodeProviderConfigFile, encodeProviderConfigFile } from "@shucode/provider-node";
import { createServiceLogger } from "../logger/serviceLogger.js";

const serviceLog = createServiceLogger("platformUserConfigApply");

/**
 * 合并两份 personal 层配置。
 * - providers：`current.overlay(incoming)`，incoming 覆盖同名 provider 的配置叶子。
 * - models：**信封中出现的 provider 由其全权定义模型集合**（旧模型被移除、新模型加入），
 *   其它 provider 的规则原样保留。这样平台缩减模型列表时不会留下失效模型；
 *   同一 provider/model 不会同时出现在智能与手动两类规则中（parse 会校验）。
 * - providerOrder：保持本地顺序，incoming 新出现的 provider 追加到末尾。
 * - defaultModelSelection：不取 incoming——云端偏好默认由服务层补档位后单独写入。
 */
export function mergePlatformUserConfigIntoPersonalConfig(
  current: Pick<
    ProviderConfigLayerUpdate,
    "providers" | "models" | "providerOrder" | "defaultModelSelection"
  >,
  incoming: ProviderConfigLayerUpdate,
): ProviderConfigLayerUpdate {
  const providers = current.providers.overlay(incoming.providers);
  const models = mergePersonalModelRules(
    current.models,
    incoming.models,
    new Set(incoming.providers.keys()),
  );
  const providerOrder = mergeProviderOrder(current.providerOrder, incoming.providerOrder);
  return {
    providers,
    models,
    ...(providerOrder ? { providerOrder } : {}),
    ...(current.defaultModelSelection
      ? { defaultModelSelection: current.defaultModelSelection }
      : {}),
  };
}

function mergePersonalModelRules(
  current: ModelConfigRules,
  incoming: ModelConfigRules,
  managedProviderIds: ReadonlySet<string>,
): ModelConfigRules {
  const currentJson = current.toPersonalJSON();
  const incomingJson = incoming.toPersonalJSON();
  const providerModelRules = [
    ...currentJson.providerModelRules.filter(
      (rule) => !managedProviderIds.has(rule.providerId),
    ),
    ...incomingJson.providerModelRules,
  ];
  const manualProviderModelRules = [
    ...currentJson.manualProviderModelRules.filter(
      (rule) => !managedProviderIds.has(rule.providerId),
    ),
    ...incomingJson.manualProviderModelRules,
  ];
  return parsePersonalModelConfigRules({ providerModelRules, manualProviderModelRules });
}

function mergeProviderOrder(
  currentOrder: readonly string[] | undefined,
  incomingOrder: readonly string[] | undefined,
): readonly string[] | undefined {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const providerId of [...(currentOrder ?? []), ...(incomingOrder ?? [])]) {
    if (seen.has(providerId)) continue;
    seen.add(providerId);
    merged.push(providerId);
  }
  return merged.length > 0 ? merged : undefined;
}

function hasPlatformModels(providers: ProviderConfigLayerUpdate["providers"]): boolean {
  const rule = providers.getRule(PLATFORM_GATEWAY_PROVIDER_ID);
  return Boolean(rule && (rule.config.personalModelIds?.length ?? 0) > 0);
}

/** 只比较业务事实，忽略 revision 等派生字段。 */
function toComparableJson(update: ProviderConfigLayerUpdate): string {
  return JSON.stringify(encodeProviderConfigFile(update).config);
}

export interface PlatformUserConfigApplierDependencies {
  readonly personalRepository: PersonalProviderConfigRepository;
  /** 删除平台 provider（实现方还需清理指向它的默认选择）。 */
  readonly deletePlatformProvider: () => Promise<void>;
  /** 应用后刷新 Registry，保证返回结果反映最新配置。 */
  readonly refreshRegistry: () => Promise<unknown>;
}

export type PlatformUserConfigApplier = (
  envelope: ProviderProvisioningEnvelope,
) => Promise<ProviderProvisioningResult>;

export function createPlatformUserConfigApplier(
  dependencies: PlatformUserConfigApplierDependencies,
): PlatformUserConfigApplier {
  return async (envelope) => {
    // 信封与本地保存复用同一 codec：不在接收端另建字段清单或模式判断。
    const incoming = decodeProviderConfigFile({ schemaVersion: 1, config: envelope.personalConfig });

    if (!hasPlatformModels(incoming.providers)) {
      // 无模型（未加入团队 / 信封不含平台 provider）：删除并清理默认选择。
      await dependencies.deletePlatformProvider();
      await dependencies.refreshRegistry();
      serviceLog.info("平台 provider 已按信封移除", { reason: "empty-models" });
      return {
        syncId: envelope.syncId,
        status: "applied",
        personalProviderCount: 0,
        credentialCount: envelope.credentials.length,
        rolledBack: false,
      };
    }

    let changed = false;
    let mergedProviderCount = 0;
    const snapshot = await dependencies.personalRepository.update((current) => {
      const merged = mergePlatformUserConfigIntoPersonalConfig(current, incoming);
      changed = toComparableJson(snapshotToUpdate(current)) !== toComparableJson(merged);
      mergedProviderCount = merged.providers.keys().length;
      return merged;
    });
    await dependencies.refreshRegistry();
    if (changed) {
      serviceLog.info("平台用户配置合并完成", {
        personalProviderCount: mergedProviderCount,
        revision: snapshot.revision,
      });
    } else {
      serviceLog.debug("平台用户配置无变化（already-applied）", {
        personalProviderCount: mergedProviderCount,
        revision: snapshot.revision,
      });
    }
    return {
      syncId: envelope.syncId,
      status: changed ? "applied" : "already-applied",
      personalProviderCount: mergedProviderCount,
      credentialCount: envelope.credentials.length,
      rolledBack: false,
    };
  };
}

function snapshotToUpdate(snapshot: ProviderConfigLayerSnapshot): ProviderConfigLayerUpdate {
  return {
    providers: snapshot.providers,
    models: snapshot.models,
    ...(snapshot.providerOrder ? { providerOrder: snapshot.providerOrder } : {}),
    ...(snapshot.defaultModelSelection
      ? { defaultModelSelection: snapshot.defaultModelSelection }
      : {}),
  };
}
