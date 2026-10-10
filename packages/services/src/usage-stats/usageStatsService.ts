import {
  appUsageDashboardQuerySchema,
  appUsageRequestSchema,
  type ApiClient,
  type AppUsageRequest,
  type AppUsageSnapshot,
} from "@shucode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { ISettingService } from "../setting/setting.js";
import type { IShucodeAgentService } from "../shucode-agent/shucodeAgent.js";
import type { IUsageStatsService } from "./usageStats.js";
import { createUsagePricing } from "./usagePricing.js";
import { acquireExternalUsageService, type ExternalUsageService } from "./external/service.js";
import { mergeUsageDashboards } from "./external/merge.js";
import { emptyUsageSnapshot } from "./usageSnapshot.js";

interface UsageStatsServiceDependencies {
  /** App Usage 经 Shucode Protocol 读取 agent 数据库真实统计。 */
  shucodeAgentService: Pick<IShucodeAgentService, "getAppUsageStats">;
  settingService: Pick<ISettingService, "get" | "update">;
  apiClient: ApiClient;
  externalUsageService?: ExternalUsageService;
}

const pricingControllers = new WeakMap<
  UsageStatsServiceDependencies["settingService"],
  ReturnType<typeof createUsagePricing>
>();

export function createUsageStatsService(
  dependencies: UsageStatsServiceDependencies,
): IUsageStatsService & { disposeAll(): void; disposeAllAndWait(): Promise<void> } {
  let pricing = pricingControllers.get(dependencies.settingService);
  if (!pricing) {
    pricing = createUsagePricing(dependencies);
    pricingControllers.set(dependencies.settingService, pricing);
  }
  const priceOwner = pricing;
  const logger = createServiceLogger("UsageStatsService");
  let external = dependencies.externalUsageService;
  let release: (() => Promise<void>) | undefined;
  let disposed = false;
  const dispose = async () => {
    disposed = true;
    await release?.();
  };
  return {
    async getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot> {
      if (disposed) throw new Error("Usage service is disposed");
      const validated = appUsageRequestSchema.parse(request);
      let dashboard = validated.dashboard;
      if (dashboard) {
        let settings;
        try {
          settings = await priceOwner.getPricing();
        } catch (error) {
          logger.warn(undefined, "models.dev pricing sync failed; using saved prices", error);
          settings = await priceOwner.read();
        }
        dashboard = { ...dashboard, prices: settings.entries };
      }
      // 定价同步可跨越 Host 关闭；恢复查询前检查，避免在已释放后新建采集 owner。
      if (disposed) throw new Error("Usage service is disposed");
      const query = { ...validated, ...(dashboard ? { dashboard } : {}) };
      if (!dashboard || dashboard.scope === "shucode")
        return dependencies.shucodeAgentService.getAppUsageStats(query);
      if (dashboard.page > 0 && !dashboard.after)
        throw new Error("Client usage pagination requires a cursor");
      // 自定义结束时间与分页快照都是上界；只优先顶层 until 会让后续页进入更晚的数据。
      const now = Date.now();
      const until = Math.min(validated.until ?? now, dashboard.until ?? now, now);
      const fixed = { ...query, until, dashboard: { ...dashboard, page: 0, until } };
      if (!external) {
        const acquired = acquireExternalUsageService();
        external = acquired.service;
        release = acquired.release;
      }
      const externalQuery = external.getDashboard(fixed).then(
        (value) => ({ value }),
        () => ({ value: undefined }),
      );
      let snapshot = emptyUsageSnapshot(validated, until);
      let shucodeError: string | undefined;
      if (!dashboard.clientId || dashboard.clientId === "shucode") {
        try {
          snapshot = await dependencies.shucodeAgentService.getAppUsageStats(fixed);
        } catch {
          shucodeError = "Shucode usage is unavailable in the current environment";
        }
      }
      const parts = [];
      if (snapshot.dashboard)
        parts.push({
          ...snapshot.dashboard,
          clientOptions: [{ id: "shucode", label: "Shucode", available: !shucodeError }],
          sourceErrors: shucodeError ? [{ clientId: "shucode", message: shucodeError }] : [],
        });
      const externalResult = await externalQuery;
      if (externalResult.value) parts.push(externalResult.value);
      else {
        parts.push({
          ...emptyUsageSnapshot(validated, until).dashboard!,
          sourceErrors: [{ clientId: "external", message: "External client usage is unavailable" }],
        });
      }
      if (disposed) throw new Error("Usage service is disposed");
      const merged = mergeUsageDashboards(
        parts,
        appUsageDashboardQuerySchema.parse({ ...dashboard, until }),
      );
      return { ...snapshot, source: "federated", dashboard: merged };
    },
    getPricing: priceOwner.getPricing,
    savePrice: priceOwner.savePrice,
    deletePrice: priceOwner.deletePrice,
    getModelsDevPrices: priceOwner.getModelsDevPrices,
    importModelsDevPrices: priceOwner.importModelsDevPrices,
    importCcSwitchPrices: priceOwner.importCcSwitchPrices,
    setModelsDevAutoSync: priceOwner.setModelsDevAutoSync,
    syncModelsDevPrices: priceOwner.syncModelsDevPrices,
    disposeAll() {
      void dispose().catch(() => undefined);
    },
    disposeAllAndWait: dispose,
  };
}
