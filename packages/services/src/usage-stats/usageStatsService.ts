/**
 * 二开定制说明：原实现装配 `BigModelUsageQuotaProvider`，同时对外提供 Coding Plan 额度、
 * 重置机会与 entitlement 快照。上述链路已删除，服务只保留 App Usage——
 * 经 Shucode Protocol `usage/stats` 读取 agent 数据库的真实统计，不再读本地 session JSON 估算。
 */
import type { AppUsageRequest, AppUsageSnapshot } from "@shucode/shared";
import type { IShucodeAgentService } from "../shucode-agent/shucodeAgent.js";
import type { IUsageStatsService } from "./usageStats.js";

interface UsageStatsServiceDependencies {
  /** App Usage 经 Shucode Protocol 读取 agent 数据库真实统计。 */
  shucodeAgentService: Pick<IShucodeAgentService, "getAppUsageStats">;
}

export function createUsageStatsService(
  dependencies: UsageStatsServiceDependencies,
): IUsageStatsService {
  return {
    async getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot> {
      return dependencies.shucodeAgentService.getAppUsageStats({
        range: request.range,
        timeZone: request.timeZone,
      });
    },
  };
}
