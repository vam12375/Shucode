/**
 * 二开定制说明：官方订阅套餐 / Coding Plan 额度链路已删除，本服务只保留 App Usage
 * ——即从 agent 本地数据库读取的真实用量统计（`getAppUsageSnapshot`）。
 * 远端套餐额度、重置机会与权益快照（entitlement）已整体移除。
 */
import type { AppUsageRequest, AppUsageSnapshot } from "@shucode/shared";
import { ServiceChannels } from "@shucode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IUsageStatsService {
  getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot>;
}

export const IUsageStatsService = createServiceDescriptor<IUsageStatsService>(
  ServiceChannels.UsageStats,
);
