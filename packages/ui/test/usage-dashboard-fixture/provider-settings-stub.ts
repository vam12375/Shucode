import type { IProviderSettingsService } from "@shucode/services";
import type { ProviderConfigObject, ProviderSettingsView } from "@shucode/provider";

/**
 * Provider Settings 只读 stub：fixture-provider 提供显示名（用量表格显示名映射），
 * secondary-provider 刻意无 providerName——覆盖「无显示名回退原始 ID」分支。
 */
const fixtureProviderSettingsView: ProviderSettingsView = {
  revision: 1,
  providerTemplates: [],
  providerOrder: ["fixture-provider", "secondary-provider"],
  providers: [
    {
      providerId: "fixture-provider",
      providerName: "Fixture Proxy",
      enabled: true,
      executable: true,
      effectiveConfig: {
        group: "standard-personal",
        access: { type: "api-key", apiKey: "fixture-key" },
        api: { type: "openai-chat-completions", baseUrl: "https://fixture.example/v1" },
      } as ProviderConfigObject,
      issues: [],
      models: [],
    },
    {
      providerId: "secondary-provider",
      enabled: true,
      executable: true,
      effectiveConfig: {
        group: "standard-personal",
        access: { type: "api-key", apiKey: "fixture-key" },
        api: { type: "openai-chat-completions", baseUrl: "https://secondary.example/v1" },
      } as ProviderConfigObject,
      issues: [],
      models: [],
    },
  ],
};

export const providerSettingsService: Pick<
  IProviderSettingsService,
  "getView" | "refresh" | "onDidChange"
> = {
  async getView() {
    return structuredClone(fixtureProviderSettingsView);
  },
  async refresh() {
    return structuredClone(fixtureProviderSettingsView);
  },
  onDidChange: () => ({ dispose() {} }),
};
