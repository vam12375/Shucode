import { createHash } from "node:crypto";
import type { ExternalUsageRecord } from "../types.js";

export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function label(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 512) : null;
}

export function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function timestamp(value: unknown, numericUnit: "ms" | "seconds" = "ms"): number | null {
  const parsed =
    typeof value === "string"
      ? Date.parse(value)
      : typeof value === "number"
        ? value * (numericUnit === "seconds" ? 1000 : 1)
        : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 8.64e15 ? parsed : null;
}

export function hasCounters(value: Record<string, unknown> | undefined, fields: string[]): boolean {
  return Boolean(
    value &&
    fields.some((field) => Number.isSafeInteger(value[field]) && (value[field] as number) >= 0),
  );
}

export function digest(fields: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export function identity(clientId: string, session: string, event: string): string {
  return `${clientId}:${encodeURIComponent(session)}:${encodeURIComponent(event)}`;
}

export function baseRecord(clientId: string, id: string, startedAt: number): ExternalUsageRecord {
  return {
    clientId,
    id,
    startedAt,
    providerId: null,
    modelId: null,
    querySource: "external-session",
    status: "unknown",
    retryCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    durationMs: null,
    timeToFirstTokenMs: null,
    hasUsage: false,
    nativeCostUSD: null,
  };
}

export function totalize(record: ExternalUsageRecord): ExternalUsageRecord {
  record.totalTokens = record.inputTokens + record.outputTokens;
  return record;
}

export function elapsed(start: number | null, end: number | null): number | null {
  return start !== null && end !== null && end >= start ? end - start : null;
}
