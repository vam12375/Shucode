import type { ExternalJsonlParser, ExternalUsageRecord } from "../types.js";
import {
  baseRecord,
  count,
  hasCounters,
  identity,
  label,
  object,
  timestamp,
  totalize,
} from "./helpers.js";

export function createClaudeParser(_fileKey: string): ExternalJsonlParser {
  const selected = new Map<string, { final: boolean; record: ExternalUsageRecord }>();
  return {
    consume(value) {
      const row = object(value);
      if (!row) return [];
      if (row.type !== "assistant") return [];
      const message = object(row.message);
      const usage = object(message?.usage);
      const messageId = label(message?.id);
      const at = timestamp(row.timestamp);
      const reason = label(message?.stop_reason);
      const apiError = row.isApiErrorMessage === true || reason === "error";
      const hasUsage = hasCounters(usage, [
        "input_tokens",
        "output_tokens",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
      ]);
      if (!messageId || at === null || (!hasUsage && !apiError && reason !== "aborted")) return [];
      const previous = selected.get(messageId);
      const output = count(usage?.output_tokens);
      const final = reason !== null || apiError;
      // 同一 message 的多块重复 usage；终态优先，旧的较小流式快照不能覆盖最终计量。
      if (
        previous &&
        ((!final && previous.final) ||
          (final === previous.final && output < previous.record.outputTokens))
      )
        return [];
      const read = count(usage?.cache_read_input_tokens);
      const write = count(usage?.cache_creation_input_tokens);
      const eventKey = `message:${messageId}`;
      const record = totalize({
        ...baseRecord(
          "claude-code",
          identity("claude-code", "provider-events", eventKey),
          previous?.record.startedAt ?? at,
        ),
        providerId: label(message?.provider ?? row.provider),
        modelId: label(message?.model),
        inputTokens: count(usage?.input_tokens) + read + write,
        outputTokens: output,
        cacheReadTokens: read,
        cacheCreationTokens: write,
        hasUsage,
        status: apiError
          ? "error"
          : reason === "aborted"
            ? "cancelled"
            : final
              ? "completed"
              : "unknown",
      });
      selected.set(messageId, { final, record });
      return [record];
    },
  };
}
