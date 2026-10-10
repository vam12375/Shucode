import { usageModelPriceSchema, type UsageModelPrice } from "@shucode/shared";
import { z } from "zod";

const decimal = z
  .string()
  .trim()
  .regex(/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/)
  .transform(Number)
  .pipe(z.number().finite().nonnegative().max(1_000_000));
const model = z.object({
  modelId: z.string().trim().min(1).max(256),
  displayName: z.string().trim().min(1).max(256),
  inputCostPerMillion: decimal,
  outputCostPerMillion: decimal,
  cacheReadCostPerMillion: decimal,
  cacheCreationCostPerMillion: decimal,
});
const fileSchema = z.object({
  version: z.number().int().min(0).max(1).default(1),
  models: z.array(model).max(2000).default([]),
  deletedModelIds: z.array(z.string().trim().max(256)).max(2000).default([]),
});

/** CC Switch v1 serializes decimal prices as strings and models without providers. */
export function parseCcSwitchPricing(json: string): {
  prices: UsageModelPrice[];
  sourceCount: number;
} {
  if (typeof json !== "string" || Buffer.byteLength(json, "utf8") > 2_000_000)
    throw new Error("CC Switch pricing JSON must be at most 2 MB");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("CC Switch pricing JSON is invalid");
  }
  const parsed = fileSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(
      `Invalid CC Switch pricing field ${issue.path.join(".") || "file"}: ${issue.message}`,
    );
  }
  const file = parsed.data;
  const deleted = new Set(file.deletedModelIds);
  const prices = new Map<string, UsageModelPrice>();
  for (const entry of file.models) {
    if (deleted.has(entry.modelId)) continue;
    prices.set(
      entry.modelId,
      usageModelPriceSchema.parse({
        modelId: entry.modelId,
        displayName: entry.displayName,
        source: "manual",
        inputUSD: entry.inputCostPerMillion,
        outputUSD: entry.outputCostPerMillion,
        cacheReadUSD: entry.cacheReadCostPerMillion,
        cacheWriteUSD: entry.cacheCreationCostPerMillion,
      }),
    );
  }
  return { prices: [...prices.values()], sourceCount: file.models.length };
}
