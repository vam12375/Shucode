import type { ExternalJsonlParser } from "../types.js";
import {
  baseRecord,
  count,
  digest,
  finite,
  hasCounters,
  identity,
  label,
  object,
  timestamp,
  totalize,
} from "./helpers.js";

export function createPiParser(fileKey: string): ExternalJsonlParser {
  let sessionId = fileKey;
  return {
    consume(value) {
      const row = object(value);
      if (!row) return [];
      if (row.type === "session") {
        sessionId = label(row.id) ?? sessionId;
        return [];
      }
      const message = object(row.message);
      const assistant = row.type === "message" && message?.role === "assistant";
      const tool = row.type === "message" && message?.role === "toolResult";
      if (!assistant && !tool && row.type !== "compaction" && row.type !== "branch_summary")
        return [];
      const usage = object(row.type === "message" ? message?.usage : row.usage);
      const reason = assistant ? label(message?.stopReason) : null;
      const hasUsage = hasCounters(usage, ["input", "output", "cacheRead", "cacheWrite"]);
      if (!hasUsage && reason !== "error" && reason !== "aborted") return [];
      const at = timestamp(row.timestamp) ?? timestamp(message?.timestamp);
      if (at === null) return [];
      const read = count(usage?.cacheRead);
      const write = count(usage?.cacheWrite);
      const costs = object(usage?.cost);
      const components = [costs?.input, costs?.output, costs?.cacheRead, costs?.cacheWrite].map(
        finite,
      );
      const nativeCostUSD =
        finite(costs?.total) ??
        (components.every((part) => part !== null)
          ? components.reduce<number>((sum, part) => sum + (part ?? 0), 0)
          : null);
      const model = assistant ? label(message?.responseModel ?? message?.model) : null;
      const provider = assistant ? label(message?.provider) : null;
      const sourceId = label(row.id);
      const eventId = sourceId
        ? digest([row.type, message?.role ?? null, sourceId, at])
        : digest([
            row.type,
            at,
            model,
            provider,
            count(usage?.input),
            count(usage?.output),
            read,
            write,
            reason,
          ]);
      return [
        totalize({
          ...baseRecord(
            "pi",
            identity("pi", sourceId ? "provider-events" : sessionId, eventId),
            at,
          ),
          providerId: provider,
          modelId: model,
          hasUsage,
          nativeCostUSD,
          inputTokens: count(usage?.input) + read + write,
          outputTokens: count(usage?.output),
          cacheReadTokens: read,
          cacheCreationTokens: write,
          status:
            reason === "error"
              ? "error"
              : reason === "aborted"
                ? "cancelled"
                : reason
                  ? "completed"
                  : "unknown",
        }),
      ];
    },
  };
}
