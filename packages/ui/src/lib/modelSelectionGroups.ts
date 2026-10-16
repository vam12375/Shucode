import {
  isShucodeAgentProvider,
  PLATFORM_GATEWAY_PROVIDER_ID,
  resolveModelProviderFamilySpecByProviderId,
  shucodeProviderAccountAccessSchema,
  type ShucodeProviderAccountAccess,
  type ShucodeProvider,
} from "@shucode/shared";
import type { ModelSelectionView } from "@shucode/services";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/shucodeCustomModelValue.js";
import { shouldShowModelVisionBadge } from "@/lib/modelVisionBadge.js";

export interface ModelProviderGroupLabelOptions {
  apiKeyLabel?: string;
  apiKeyBadgeLabel?: string;
  codingPlanLabel?: string;
  codingPlanBadgeLabel?: string;
  startPlanLabel?: string;
  startPlanBadgeLabel?: string;
  teamPlanBadgeLabel?: string;
  teamPlanFallbackLabel?: string;
  /** 官方平台 provider 分组的角标文案；缺省时不加角标（置顶仍然生效）。 */
  officialBadgeLabel?: string;
}

/**
 * 官方平台 provider 分组的品牌色徽标：与默认中性徽标（MODEL_CONFIG_SELECT_BADGE_CLASS_NAME）
 * 同形不同色，经 tailwind-merge 覆写底色与文字色（亮暗主题都走 --color-brand token）。
 * 放在本模块而非 ModelConfigSelect.tsx：分组语义是分组构建层的事实，且保证本模块可单测。
 */
export const MODEL_SELECT_OFFICIAL_BADGE_CLASS_NAME =
  "shrink-0 rounded-full border border-brand/30 bg-brand/10 px-1 py-px text-ui-xs font-medium leading-normal text-brand";

function supportsRegistryApiFormat(
  selectedProvider: ShucodeProvider,
  apiFormat: string | null | undefined,
): boolean {
  if (!apiFormat) return false;
  // 仅剩 glm（Shucode Agent）provider；三方 CLI 的 api format 差异已随 provider 下线。
  return isShucodeAgentProvider(selectedProvider);
}

export function buildRegistryModelSelectGroups(
  selectedProvider: ShucodeProvider,
  view: ModelSelectionView,
  labels: ModelProviderGroupLabelOptions = {},
): ModelSelectGroup[] {
  const groups = view.providers.flatMap((provider) => {
    if (!supportsRegistryApiFormat(selectedProvider, provider.config.api?.type)) {
      return [];
    }

    const accountAccess = shucodeProviderAccountAccessSchema.safeParse(provider.config.access);
    const accountPresentation = accountAccess.success
      ? getRegistryAccountProviderGroupPresentation(provider.providerId, accountAccess.data, labels)
      : null;
    const isOfficialPlatformProvider = provider.providerId === PLATFORM_GATEWAY_PROVIDER_ID;

    return [
      {
        key: `registry-provider:${provider.providerId}`,
        label: accountPresentation?.label || provider.providerName?.trim() || provider.providerId,
        ...(accountPresentation?.labelBadge ? { labelBadge: accountPresentation.labelBadge } : {}),
        // 官方平台 provider 用品牌色角标与本地供应商区分；角标文案由调用方提供（i18n）。
        ...(isOfficialPlatformProvider && labels.officialBadgeLabel
          ? {
              labelBadge: labels.officialBadgeLabel,
              labelBadgeClassName: MODEL_SELECT_OFFICIAL_BADGE_CLASS_NAME,
            }
          : {}),
        ...(accountPresentation ? { directItems: true } : {}),
        items: provider.models.map(({ modelId, config }) => ({
          key: `registry-provider:${provider.providerId}:${modelId}`,
          value: encodeCustomModelValue(provider.providerId, modelId),
          name: modelId,
          ...(shouldShowModelVisionBadge(
            modelId,
            config.properties?.inputFormat?.supportsImage,
            provider.config.access,
          )
            ? { supportsVisionInput: true }
            : {}),
        })),
      },
    ];
  });

  // 登录同步把平台 provider 追加到 personal 层 providerOrder 末尾（见 platformUserConfigApply
  // 的 mergeProviderOrder）：展示层固定把官方平台 provider 排到第一位，其余保持 Registry 原序。
  return withOfficialPlatformProviderFirst(groups);
}

/** 官方平台 provider 分组置顶（稳定性重排：仅移动该组，其余相对顺序不变）。 */
function withOfficialPlatformProviderFirst(groups: ModelSelectGroup[]): ModelSelectGroup[] {
  const index = groups.findIndex(
    (group) => group.key === `registry-provider:${PLATFORM_GATEWAY_PROVIDER_ID}`,
  );
  if (index <= 0) {
    return groups;
  }
  const reordered = [...groups];
  const official = reordered.splice(index, 1)[0];
  if (official) {
    reordered.unshift(official);
  }
  return reordered;
}

function getRegistryAccountProviderGroupPresentation(
  providerId: string,
  access: ShucodeProviderAccountAccess,
  labels: ModelProviderGroupLabelOptions,
): Pick<ModelSelectGroup, "label" | "labelBadge"> {
  const familySpec = resolveModelProviderFamilySpecByProviderId(providerId);
  const label = familySpec?.label ?? providerId;
  if (access.mode === "start-plan") {
    return { label: "Start Plan", labelBadge: labels.startPlanBadgeLabel ?? "Free" };
  }
  if (access.mode === "team-coding-plan") {
    return { label, labelBadge: labels.teamPlanBadgeLabel ?? "Team" };
  }
  return { label, labelBadge: labels.codingPlanBadgeLabel ?? "Individual" };
}

export function resolveModelDisplayName(
  modelGroups: readonly ModelSelectGroup[],
  value: string,
): string | null {
  for (const group of modelGroups) {
    const matched = group.items.find((item) => item.value === value);
    if (matched) return matched.name;
  }

  return decodeCustomModelValue(value)?.modelName ?? null;
}
