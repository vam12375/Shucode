import { z } from "zod";

const priceSchema = z.number().finite().nonnegative().max(1_000_000);
export const usageModelPriceSchema = z.object({
  modelId: z.string().trim().min(1).max(256),
  providerId: z.string().trim().min(1).max(256).optional(),
  displayName: z.string().trim().max(256).optional(),
  inputUSD: priceSchema,
  outputUSD: priceSchema,
  cacheReadUSD: priceSchema.nullable(),
  cacheWriteUSD: priceSchema.nullable(),
  source: z.enum(["manual", "models-dev"]),
  catalogKey: z.string().max(512).optional(),
});
export type UsageModelPrice = z.infer<typeof usageModelPriceSchema>;

export const usagePricingSettingsSchema = z.object({
  entries: z.array(usageModelPriceSchema).max(2000).default([]),
  modelsDevAutoSync: z.boolean().default(false),
  modelsDevSelectedKeys: z.array(z.string().max(512)).max(2000).default([]),
  lastSyncedAt: z.number().int().nonnegative().nullable().default(null),
});
export type UsagePricingSettings = z.infer<typeof usagePricingSettingsSchema>;

export const usagePricingImportResultSchema = z.object({
  settings: usagePricingSettingsSchema,
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type UsagePricingImportResult = z.infer<typeof usagePricingImportResultSchema>;

export function usagePriceKey(price: Pick<UsageModelPrice, "providerId" | "modelId">): string {
  return JSON.stringify([price.providerId ?? null, price.modelId]);
}
