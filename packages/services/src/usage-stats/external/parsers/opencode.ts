import type { ExternalUsageRecord } from "../types.js";
import {
  baseRecord,
  count,
  digest,
  elapsed,
  finite,
  hasCounters,
  identity,
  label,
  object,
  timestamp,
  totalize,
} from "./helpers.js";

export function parseOpenCodeMessage(value: unknown, fileKey: string): ExternalUsageRecord[] {
  const row = object(value);
  if (!row) return [];
  let message = row;
  if (typeof row.data === "string") {
    try {
      message = object(JSON.parse(row.data)) ?? {};
    } catch {
      return [];
    }
  } else if (object(row.data)) message = object(row.data)!;
  const kind = message.role ?? message.type ?? row.type;
  if (kind !== "assistant" && kind !== "compaction") return [];
  const usage = object(message.tokens);
  const cache = object(usage?.cache);
  const hasUsage =
    hasCounters(usage, ["input", "output", "reasoning"]) || hasCounters(cache, ["read", "write"]);
  const error = object(message.error);
  if (!hasUsage && !error) return [];
  const time = object(message.time);
  const at = timestamp(time?.created ?? row.time_created);
  if (at === null) return [];
  const session = label(row.session_id ?? message.sessionID ?? row.sessionID) ?? fileKey;
  const route = object(message.model);
  const model = label(message.modelID ?? route?.id ?? message.model);
  const provider = label(message.providerID ?? route?.providerID);
  const read = count(cache?.read);
  const write = count(cache?.write);
  const id =
    label(row.id ?? message.id) ??
    digest([at, model, provider, count(usage?.input), count(usage?.output), read, write]);
  const completedAt = timestamp(time?.completed);
  return [
    totalize({
      ...baseRecord("opencode", identity("opencode", session, id), at),
      providerId: provider,
      modelId: model,
      hasUsage,
      inputTokens: count(usage?.input) + read + write,
      outputTokens: count(usage?.output) + count(usage?.reasoning),
      cacheReadTokens: read,
      cacheCreationTokens: write,
      nativeCostUSD: finite(message.cost),
      durationMs: elapsed(at, completedAt),
      status:
        error?.name === "MessageAbortedError" || error?.name === "AbortedError"
          ? "cancelled"
          : error || message.status === "failed"
            ? "error"
            : completedAt !== null || message.status === "completed"
              ? "completed"
              : "unknown",
    }),
  ];
}
