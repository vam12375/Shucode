import { usageModelPriceSchema } from "@shucode/shared";
import type { UsageModelPrice } from "@shucode/shared";

export type UsageTrendMetric = "tokens" | "requests" | "cost";
export type UsagePriceDraft = {
  modelId: string;
  providerId: string;
  displayName: string;
  inputUSD: string;
  outputUSD: string;
  cacheReadUSD: string;
  cacheWriteUSD: string;
};

export function createUsagePriceDraft(price?: UsageModelPrice): UsagePriceDraft {
  return {
    modelId: price?.modelId ?? "",
    providerId: price?.providerId ?? "",
    displayName: price?.displayName ?? "",
    inputUSD: price ? String(price.inputUSD) : "",
    outputUSD: price ? String(price.outputUSD) : "",
    cacheReadUSD: price?.cacheReadUSD == null ? "" : String(price.cacheReadUSD),
    cacheWriteUSD: price?.cacheWriteUSD == null ? "" : String(price.cacheWriteUSD),
  };
}

export function parseUsagePriceDraft(draft: UsagePriceDraft): UsageModelPrice | null {
  // 空字符串不能经 Number 转为 0：缺失价格与用户明确填写的零价语义不同。
  const requiredNumber = (value: string) => (value.trim() === "" ? NaN : Number(value));
  const optionalNumber = (value: string) => (value.trim() === "" ? null : Number(value));
  const result = usageModelPriceSchema.safeParse({
    modelId: draft.modelId,
    providerId: draft.providerId.trim() || undefined,
    displayName: draft.displayName.trim() || undefined,
    inputUSD: requiredNumber(draft.inputUSD),
    outputUSD: requiredNumber(draft.outputUSD),
    cacheReadUSD: optionalNumber(draft.cacheReadUSD),
    cacheWriteUSD: optionalNumber(draft.cacheWriteUSD),
    source: "manual",
  });
  return result.success ? result.data : null;
}

export function formatUsageUSD(
  locale: string,
  value: number | null,
  unpricedLabel: string,
): string {
  if (value === null || !Number.isFinite(value)) return unpricedLabel;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 4,
  }).format(value);
}

export function filterModelsDevPrices(
  prices: UsageModelPrice[],
  search: string,
): UsageModelPrice[] {
  const needle = search.trim().toLocaleLowerCase();
  return prices.filter(
    (price) =>
      !needle ||
      `${price.providerId ?? ""} ${price.modelId} ${price.displayName ?? ""}`
        .toLocaleLowerCase()
        .includes(needle),
  );
}
