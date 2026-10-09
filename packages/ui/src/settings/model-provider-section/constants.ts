import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";

/**
 * 二开定制：本模块只服务「自定义供应商（personal provider + API key）」。
 * 官方账号 Provider（Z.ai / BigModel）、编程套餐 / 团队套餐 / Start Plan 的
 * 导航项、状态与商品配置已全部下线，不再出现在导航与详情区。
 */

export function resolveModelProviderDisplayName(
  provider: Pick<ProviderSettingsFormProvider, "providerId" | "config">,
): string {
  return getProviderFormLabel(provider);
}

export type ModelProviderNavItem = {
  key: string;
  type: "custom";
  label: string;
  provider: ProviderSettingsFormProvider;
  statusActive: boolean;
};

export type ModelProviderNavGroupId = "custom";

export interface ModelProviderNavGroup {
  id: ModelProviderNavGroupId;
  title: string;
  items: ModelProviderNavItem[];
}
