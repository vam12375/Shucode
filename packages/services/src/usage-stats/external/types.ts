import type { AppUsageRequestLog } from "@shucode/shared";

/** Adapter output: total input includes cache read/write; output includes reasoning. */
export interface ExternalUsageRecord extends Omit<AppUsageRequestLog, "costUSD"> {
  hasUsage: boolean;
  nativeCostUSD?: number | null;
}

export interface ExternalJsonlParser {
  consume(value: unknown): ExternalUsageRecord[];
}

export interface ExternalSourceStatus {
  id: string;
  label: string;
  available: boolean;
  error?: string;
}
