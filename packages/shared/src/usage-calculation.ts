import type { UsageModelPrice } from "./usage-pricing.js";

const NANOS_PER_USD = 1_000_000_000;
const TOKENS_PER_MILLION = 1_000_000;

export function createUsageCost(prices: readonly UsageModelPrice[]) {
  const exact = new Map<string, UsageModelPrice>();
  const generic = new Map<string, UsageModelPrice>();
  for (const price of prices.filter((entry) => entry.source === "models-dev")) {
    if (price.providerId) exact.set(JSON.stringify([price.providerId, price.modelId]), price);
  }
  for (const price of prices.filter((entry) => entry.source === "manual")) {
    if (price.providerId) exact.set(JSON.stringify([price.providerId, price.modelId]), price);
    else generic.set(price.modelId, price);
  }
  return (
    providerId: string | null,
    modelId: string | null,
    input: number,
    output: number,
    read: number,
    write: number,
    hasUsage: boolean,
  ): bigint | null => {
    const specific = exact.get(JSON.stringify([providerId, modelId]));
    const price =
      specific?.source === "manual" ? specific : (generic.get(modelId ?? "") ?? specific);
    if (
      !hasUsage ||
      !price ||
      (read > 0 && price.cacheReadUSD === null) ||
      (write > 0 && price.cacheWriteUSD === null)
    )
      return null;
    // 总输入包含缓存，推理属于总输出；两者不能重复收费。
    const fresh = Math.max(0, input - read - write);
    const usd =
      (fresh * price.inputUSD +
        output * price.outputUSD +
        read * (price.cacheReadUSD ?? 0) +
        write * (price.cacheWriteUSD ?? 0)) /
      TOKENS_PER_MILLION;
    return BigInt(Math.round(usd * NANOS_PER_USD));
  };
}

export function nanosToUSD(value: number | bigint | null): number | null {
  return value === null ? null : Number(value) / NANOS_PER_USD;
}
