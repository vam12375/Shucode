import {
  usageModelPriceSchema,
  usagePriceKey,
  usagePricingSettingsSchema,
  type ApiClient,
  type UsageModelPrice,
  type UsagePricingImportResult,
  type UsagePricingSettings,
} from "@shucode/shared";
import type { ISettingService } from "../setting/setting.js";
import { createModelsDevCatalog } from "./modelsDevPricing.js";
import { parseCcSwitchPricing } from "./ccSwitchPricing.js";
import { z } from "zod";

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

function mergeCatalogPrices(
  settings: UsagePricingSettings,
  prices: UsageModelPrice[],
  keys: string[],
): UsagePricingSettings {
  const selected = new Set(keys);
  const entries = new Map(settings.entries.map((price) => [usagePriceKey(price), price]));
  for (const price of prices) {
    if (!price.catalogKey || !selected.has(price.catalogKey)) continue;
    const key = usagePriceKey(price);
    if (entries.get(key)?.source === "manual") continue;
    entries.set(key, price);
  }
  return { ...settings, entries: [...entries.values()] };
}

export function createUsagePricing(dependencies: {
  settingService: Pick<ISettingService, "get" | "update">;
  apiClient: ApiClient;
}) {
  const catalog = createModelsDevCatalog(dependencies.apiClient);
  let writeQueue: Promise<void> = Promise.resolve();
  let syncInFlight: Promise<UsagePricingSettings> | undefined;
  let syncForced = false;

  async function readCurrent(): Promise<UsagePricingSettings> {
    const settings = await dependencies.settingService.get();
    return usagePricingSettingsSchema.parse(settings.usagePricing ?? {});
  }

  async function read(): Promise<UsagePricingSettings> {
    await writeQueue;
    return readCurrent();
  }

  function update(
    change: (settings: UsagePricingSettings) => UsagePricingSettings,
  ): Promise<UsagePricingSettings> {
    const writing = writeQueue.then(async () => {
      const next = usagePricingSettingsSchema.parse(change(await readCurrent()));
      await dependencies.settingService.update({ usagePricing: next });
      return next;
    });
    writeQueue = writing.then(
      () => undefined,
      () => undefined,
    );
    return writing;
  }

  function sync(force: boolean): Promise<UsagePricingSettings> {
    if (syncInFlight) {
      syncForced ||= force;
      return syncInFlight;
    }
    syncForced = force;
    syncInFlight = (async () => {
      const before = await read();
      if (!before.modelsDevSelectedKeys.length) return before;
      if (
        !syncForced &&
        (!before.modelsDevAutoSync ||
          (before.lastSyncedAt !== null && Date.now() - before.lastSyncedAt < SYNC_INTERVAL_MS))
      ) {
        return before;
      }
      const prices = await catalog.get(true);
      // 网络请求期间可能发生手工编辑，提交时读取最新设置并保留手工价格。
      return update((latest) => {
        if (!syncForced && !latest.modelsDevAutoSync) return latest;
        return {
          ...mergeCatalogPrices(latest, prices, latest.modelsDevSelectedKeys),
          lastSyncedAt: Date.now(),
        };
      });
    })().finally(() => {
      syncInFlight = undefined;
    });
    return syncInFlight;
  }

  return {
    read,
    async getPricing(): Promise<UsagePricingSettings> {
      if (syncInFlight) return syncInFlight;
      const current = await read();
      if (
        !current.modelsDevAutoSync ||
        !current.modelsDevSelectedKeys.length ||
        (current.lastSyncedAt !== null && Date.now() - current.lastSyncedAt < SYNC_INTERVAL_MS)
      ) {
        return current;
      }
      return sync(false);
    },
    async savePrice(value: UsageModelPrice, previousKey?: string): Promise<UsagePricingSettings> {
      const price = usageModelPriceSchema.parse({ ...value, source: "manual" });
      const replacingKey =
        previousKey === undefined ? undefined : z.string().min(1).max(1024).parse(previousKey);
      return update((latest) => {
        const renamed =
          replacingKey !== usagePriceKey(price)
            ? latest.entries.find((entry) => usagePriceKey(entry) === replacingKey)
            : undefined;
        const previous = latest.entries.find(
          (entry) => usagePriceKey(entry) === usagePriceKey(price),
        );
        const savedPrice =
          price.catalogKey || !previous?.catalogKey
            ? price
            : { ...price, catalogKey: previous.catalogKey };
        return {
          ...latest,
          entries: [
            ...latest.entries.filter((entry) => {
              const key = usagePriceKey(entry);
              return key !== usagePriceKey(price) && key !== replacingKey;
            }),
            savedPrice,
          ],
          modelsDevSelectedKeys: renamed?.catalogKey
            ? latest.modelsDevSelectedKeys.filter((selected) => selected !== renamed.catalogKey)
            : latest.modelsDevSelectedKeys,
        };
      });
    },
    async deletePrice(key: string): Promise<UsagePricingSettings> {
      z.string().min(1).max(1024).parse(key);
      return update((latest) => {
        const deleting = latest.entries.find((entry) => usagePriceKey(entry) === key);
        return {
          ...latest,
          entries: latest.entries.filter((entry) => usagePriceKey(entry) !== key),
          modelsDevSelectedKeys: deleting?.catalogKey
            ? latest.modelsDevSelectedKeys.filter((selected) => selected !== deleting.catalogKey)
            : latest.modelsDevSelectedKeys,
        };
      });
    },
    getModelsDevPrices: () => catalog.get(),
    async importCcSwitchPrices(json: string): Promise<UsagePricingImportResult> {
      const parsed = parseCcSwitchPricing(json);
      let imported = 0;
      const settings = await update((latest) => {
        const entries = new Map(latest.entries.map((price) => [usagePriceKey(price), price]));
        for (const price of parsed.prices) {
          const key = usagePriceKey(price);
          const previous = entries.get(key);
          if (previous?.source === "manual") continue;
          entries.set(
            key,
            previous?.catalogKey ? { ...price, catalogKey: previous.catalogKey } : price,
          );
          imported += 1;
        }
        if (entries.size > 2000)
          throw new Error("Imported pricing would exceed the 2000 model limit");
        return { ...latest, entries: [...entries.values()] };
      });
      return { settings, imported, skipped: parsed.sourceCount - imported };
    },
    async importModelsDevPrices(keys: string[]): Promise<UsagePricingSettings> {
      z.array(z.string().min(1).max(512)).max(2000).parse(keys);
      const prices = await catalog.get();
      const selected = [...new Set(keys)];
      const knownKeys = new Set(prices.map((price) => price.catalogKey));
      if (selected.some((key) => !knownKeys.has(key))) {
        throw new Error("Selected models.dev prices are unavailable");
      }
      return update((latest) => ({
        ...mergeCatalogPrices(latest, prices, selected),
        modelsDevSelectedKeys: [...new Set([...latest.modelsDevSelectedKeys, ...selected])],
        lastSyncedAt: Date.now(),
      }));
    },
    async setModelsDevAutoSync(enabled: boolean): Promise<UsagePricingSettings> {
      if (typeof enabled !== "boolean") throw new Error("Invalid models.dev auto-sync setting");
      return update((latest) => ({ ...latest, modelsDevAutoSync: enabled }));
    },
    syncModelsDevPrices: () => sync(true),
  };
}
