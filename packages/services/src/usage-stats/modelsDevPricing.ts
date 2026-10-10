import { usageModelPriceSchema, type ApiClient, type UsageModelPrice } from "@shucode/shared";
import { z } from "zod";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CATALOG_TTL_MS = 60 * 60 * 1000;
const catalogSchema = z.record(
  z.string(),
  z.object({
    models: z.record(z.string(), z.unknown()).optional(),
  }),
);
const costSchema = z.number().finite().nonnegative().max(1_000_000);
const modelSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  cost: z.object({
    input: costSchema,
    output: costSchema,
    cache_read: costSchema.nullish(),
    cache_write: costSchema.nullish(),
  }),
});

export function parseModelsDevPrices(value: unknown): UsageModelPrice[] {
  const catalog = catalogSchema.parse(value);
  const prices: UsageModelPrice[] = [];
  for (const [providerId, provider] of Object.entries(catalog)) {
    for (const [nativeId, rawModel] of Object.entries(provider.models ?? {})) {
      const model = modelSchema.safeParse(rawModel);
      if (!model.success) continue;
      const price = usageModelPriceSchema.safeParse({
        providerId,
        modelId: model.data.id?.trim() || nativeId,
        ...(model.data.name ? { displayName: model.data.name } : {}),
        inputUSD: model.data.cost.input,
        outputUSD: model.data.cost.output,
        cacheReadUSD: model.data.cost.cache_read ?? null,
        cacheWriteUSD: model.data.cost.cache_write ?? null,
        source: "models-dev",
        catalogKey: `${providerId}/${nativeId}`,
      });
      if (price.success) prices.push(price.data);
    }
  }
  return prices;
}

export function createModelsDevCatalog(apiClient: ApiClient) {
  let cache: { fetchedAt: number; prices: UsageModelPrice[] } | undefined;
  let inFlight: Promise<UsageModelPrice[]> | undefined;

  async function fetchPrices(): Promise<UsageModelPrice[]> {
    const response = await apiClient.request(MODELS_DEV_URL, {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
      timeoutMs: 30_000,
    });
    if (!response.ok) throw new Error(`models.dev request failed: HTTP ${response.status}`);
    const prices = parseModelsDevPrices(await response.json());
    cache = { fetchedAt: Date.now(), prices };
    return prices;
  }

  return {
    async get(force = false): Promise<UsageModelPrice[]> {
      if (!force && cache && Date.now() - cache.fetchedAt < CATALOG_TTL_MS) {
        return structuredClone(cache.prices);
      }
      if (!inFlight) {
        inFlight = fetchPrices().finally(() => {
          inFlight = undefined;
        });
      }
      return structuredClone(await inFlight);
    },
  };
}
