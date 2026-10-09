/**
 * 二开定制说明（`coding-plan-subscription` 服务）：
 *
 * 官方订阅套餐 / 编程套餐 / Start Plan / 团队套餐 / 购买充值 / 订单支付 / 套餐额度整条链路
 * 已从代码中删除，客户端只保留「自定义（personal）Provider + API key」。
 *
 * 本接口**唯一职责**：读取平台 `client/configs`，为两个保留功能提供灰度配置——
 *   1. `getOffPeakClientConfig`：闲时任务（Off-Peak）曝光开关与模型视图；
 *   2. `getDynamicWorkflowClientConfig`：动态工作流灰度模式。
 *
 * 服务名、RPC 通道名（`ServiceChannels.CodingPlanSubscription` = `coding-plan-subscription`）
 * 与描述符保持不变：它们是 desktop host/client 代理的 wire 契约，改名会牵动远端代理，
 * 且 host 侧 `remoteWorkspaceServiceCollection` 仍按该通道注册本服务。
 */
import type { DynamicWorkflowClientConfig } from "@shucode/shared";
import type { ModelSelectionView } from "@shucode/provider";
import { ServiceChannels } from "@shucode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface OffPeakClientConfig {
  readonly enabled: boolean;
  readonly modelSelectionView: ModelSelectionView;
  /** mock 演示强制通道：真实路径不下发，UI 使用 Host 的 Account support。 */
  readonly codingPlanActive?: boolean;
}

export interface ICodingPlanSubscriptionService {
  /** 闲时任务灰度配置：forceRefresh 供入口打开时补拉（绕过 1h 快照缓存）。 */
  getOffPeakClientConfig(options?: { forceRefresh?: boolean }): Promise<OffPeakClientConfig>;
  /**
   * 动态工作流灰度快照：远端 `configs.dynamicWorkflow.mode`
   * 与本地覆盖折叠后的结果；forceRefresh 绕过 1h 快照缓存。请求失败 fail-closed（disabled/default）。
   */
  getDynamicWorkflowClientConfig(options?: {
    forceRefresh?: boolean;
  }): Promise<DynamicWorkflowClientConfig>;
}

export const ICodingPlanSubscriptionService =
  createServiceDescriptor<ICodingPlanSubscriptionService>(ServiceChannels.CodingPlanSubscription);
