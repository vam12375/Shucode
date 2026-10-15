import type { ProviderProvisioningResult } from "@shucode/shared";
import { ServiceChannels } from "@shucode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/**
 * 平台用户级配置同步服务。
 *
 * 登录后（及约 1 小时周期）拉取 /api/v1/client/user-config，返回的
 * ProviderProvisioningEnvelope 经本地 Provisioning 目标写到 personal 层；
 * 应用语义（syncId 幂等 / CAS / 回滚）与 SSH/WSL 远端同步共用同一实现。
 */

export type PlatformUserConfigSyncResult =
  | { kind: "applied" }
  | { kind: "already-applied" }
  | { kind: "skipped"; reason: "no-credential" | "in-flight" }
  | { kind: "failed"; message: string; unauthorized?: boolean };

export interface PlatformUserConfigSyncStatus {
  lastSyncAt: string | null;
  lastResult: PlatformUserConfigSyncResult | null;
  /** 最近一次成功应用到的 provisioning 结果（含 configRevision）。 */
  lastApply: ProviderProvisioningResult | null;
}

export interface IPlatformUserConfigService {
  /** 拉取并应用用户级配置；无凭据时 skipped，网络/服务失败时 failed 且保留旧配置。 */
  refresh(): Promise<PlatformUserConfigSyncResult>;
  getStatus(): PlatformUserConfigSyncStatus;
  /** 启动周期同步（立即一次 + 每 intervalMs）；重复调用无效。 */
  start(): void;
  dispose(): void;
}

export const IPlatformUserConfigService = createServiceDescriptor<IPlatformUserConfigService>(
  ServiceChannels.PlatformUserConfig,
);
