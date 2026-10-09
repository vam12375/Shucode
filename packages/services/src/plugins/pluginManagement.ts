// 平台能力面收敛：设置页「插件管理」的薄服务接口。
//
// 背景：pluginManagementStore / usePluginUninstall 过去直接注入 IShucodeAgentService，
// UI 层因此散布 13 个 plugins/* 旧协议词的消费点。收敛为独立薄 service 后，UI 只依赖
// 本接口；plugins/* 词表的 host 侧消费点收拢到 pluginManagementService 一处（插件的
// 事实源在 shucode-cli 进程，服务实现仍经 agent 协议往返——plugins 词表的收口归属
// 插件能力面自身的协议演进，不在会话 v4 词表范围内）。
// 注意与既有 IPluginsService（已 retired 的 marketplace pluginStore 通道）区分：
// 那套接口按 pluginName+marketplace 寻址且方法语义过时，不复用避免签名冲突。
import type { Event } from "@shucode/rpc";
import type {
  ShucodePluginOperationProgressNotification,
  ShucodePluginsConfigureResult,
  ShucodePluginsCancelOperationResult,
  ShucodePluginsDescribeResult,
  ShucodePluginsInstallResult,
  ShucodePluginsListResult,
  ShucodePluginsMarketplaceMutationResult,
  ShucodePluginsOverviewResult,
  ShucodePluginsReferenceCatalogResult,
  ShucodePluginsRestoreBuiltinResult,
  ShucodePluginsSetEnabledResult,
  ShucodePluginsUninstallResult,
  ShucodePluginsValidateResult,
} from "@shucode/shared";
import { ServiceChannels } from "@shucode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  ShucodeAgentAddPluginMarketplaceParams,
  ShucodeAgentConfigurePluginParams,
  ShucodeAgentCancelPluginOperationParams,
  ShucodeAgentDescribePluginParams,
  ShucodeAgentInstallPluginParams,
  ShucodeAgentPluginReferenceCatalogParams,
  ShucodeAgentResolveSuggestedPluginReferenceParams,
  ShucodeAgentResetPluginConfigParams,
  ShucodeAgentPluginViewParams,
  ShucodeAgentRemovePluginMarketplaceParams,
  ShucodeAgentRestoreBuiltinPluginParams,
  ShucodeAgentSetPluginEnabledParams,
  ShucodeAgentUninstallPluginParams,
  ShucodeAgentUpdatePluginMarketplaceParams,
  ShucodeAgentUpdatePluginParams,
  ShucodeAgentValidatePluginParams,
} from "../shucode-agent/shucodeAgentPluginParams.js";

export interface IPluginManagementService {
  listPlugins(params: ShucodeAgentPluginViewParams): Promise<ShucodePluginsListResult>;
  /**
   * Plugin 对话引用 catalog：
   * 带 sessionId → session-owned 冻结 catalog；不带 → workspace 当前 catalog。
   * 实现路由到 workspace 级 agent client，不走插件管理独立进程。
   */
  getPluginReferenceCatalog(
    params: ShucodeAgentPluginReferenceCatalogParams,
  ): Promise<ShucodePluginsReferenceCatalogResult>;
  resolveSuggestedPluginReference(
    params: ShucodeAgentResolveSuggestedPluginReferenceParams,
  ): Promise<import("@shucode/shared").ShucodePluginsResolveSuggestedReferenceResult>;
  onDynamicPluginOperationProgress(
    operationId: string,
  ): Event<ShucodePluginOperationProgressNotification>;
  getPluginsOverview(params: ShucodeAgentPluginViewParams): Promise<ShucodePluginsOverviewResult>;
  addPluginMarketplace(
    params: ShucodeAgentAddPluginMarketplaceParams,
  ): Promise<ShucodePluginsMarketplaceMutationResult>;
  removePluginMarketplace(
    params: ShucodeAgentRemovePluginMarketplaceParams,
  ): Promise<ShucodePluginsMarketplaceMutationResult>;
  updatePluginMarketplace(
    params: ShucodeAgentUpdatePluginMarketplaceParams,
  ): Promise<ShucodePluginsMarketplaceMutationResult>;
  installPlugin(params: ShucodeAgentInstallPluginParams): Promise<ShucodePluginsInstallResult>;
  cancelPluginOperation(
    params: ShucodeAgentCancelPluginOperationParams,
  ): Promise<ShucodePluginsCancelOperationResult>;
  uninstallPlugin(
    params: ShucodeAgentUninstallPluginParams,
  ): Promise<ShucodePluginsUninstallResult>;
  updatePlugin(params: ShucodeAgentUpdatePluginParams): Promise<ShucodePluginsInstallResult>;
  restoreBuiltinPlugin(
    params: ShucodeAgentRestoreBuiltinPluginParams,
  ): Promise<ShucodePluginsRestoreBuiltinResult>;
  configurePlugin(
    params: ShucodeAgentConfigurePluginParams,
  ): Promise<ShucodePluginsConfigureResult>;
  resetPluginConfig(
    params: ShucodeAgentResetPluginConfigParams,
  ): Promise<ShucodePluginsConfigureResult>;
  validatePlugin(params: ShucodeAgentValidatePluginParams): Promise<ShucodePluginsValidateResult>;
  describePlugin(params: ShucodeAgentDescribePluginParams): Promise<ShucodePluginsDescribeResult>;
  setPluginEnabled(
    params: ShucodeAgentSetPluginEnabledParams,
  ): Promise<ShucodePluginsSetEnabledResult>;
}

export const IPluginManagementService = createServiceDescriptor<IPluginManagementService>(
  ServiceChannels.PluginManagement,
);
