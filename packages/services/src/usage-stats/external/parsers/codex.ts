import type { ExternalJsonlParser } from "../types.js";
import {
  baseRecord,
  count,
  digest,
  hasCounters,
  identity,
  label,
  object,
  timestamp,
  totalize,
} from "./helpers.js";

interface Tokens {
  input: number;
  output: number;
  read: number;
  write: number;
}
export interface CodexReplayInfo {
  sessionId: string;
  parentThreadId: string | null;
  createdAt: number | null;
  maxTimestamp: number | null;
  tokenEvents: { signature: string; timestamp: number | null }[];
}
export interface CodexParser extends ExternalJsonlParser {
  readonly requiresParent: boolean;
  getReplayInfo(): CodexReplayInfo;
}

function tokens(value: unknown): Tokens | undefined {
  const usage = object(value);
  if (
    !hasCounters(usage, [
      "input_tokens",
      "output_tokens",
      "cached_input_tokens",
      "cache_read_input_tokens",
      "cache_write_input_tokens",
    ])
  )
    return;
  return {
    input: count(usage?.input_tokens),
    output: count(usage?.output_tokens),
    read: count(usage?.cached_input_tokens ?? usage?.cache_read_input_tokens),
    write: count(usage?.cache_write_input_tokens),
  };
}

export function createCodexParser(
  fileKey: string,
  options: { parentSignatures?: readonly string[] } = {},
): CodexParser {
  let sessionId = fileKey;
  let rootMetaSeen = false;
  let parentThreadId: string | null = null;
  let conflictingParent = false;
  let createdAt: number | null = null;
  let maxTimestamp: number | null = null;
  let provider: string | null = null;
  let model: string | null = null;
  let highWater: Tokens = { input: 0, output: 0, read: 0, write: 0 };
  let previousSignature: string | null = null;
  const signatureBySource = new Map<string, string>();
  const events: CodexReplayInfo["tokenEvents"] = [];
  let replayOffset = 0;
  let replayPrefix = true;
  return {
    get requiresParent() {
      return conflictingParent || Boolean(parentThreadId && !options.parentSignatures);
    },
    getReplayInfo() {
      return { sessionId, parentThreadId, createdAt, maxTimestamp, tokenEvents: [...events] };
    },
    consume(value) {
      const row = object(value);
      const rowAt = timestamp(row?.timestamp);
      if (rowAt !== null) maxTimestamp = Math.max(maxTimestamp ?? 0, rowAt);
      const payload = object(row?.payload);
      if (!row || !payload) return [];
      if (row.type === "session_meta") {
        // fork 回放可能包含旧 metadata；只允许首条 root meta 决定身份和继承边界。
        if (rootMetaSeen) return [];
        rootMetaSeen = true;
        sessionId = label(payload.id ?? payload.thread_id ?? payload.threadId) ?? sessionId;
        createdAt = timestamp(row.timestamp);
        provider = label(payload.model_provider);
        const forked = label(payload.forked_from_id);
        const spawn = object(object(object(payload.source)?.subagent)?.thread_spawn);
        const spawned = label(spawn?.parent_thread_id);
        conflictingParent = Boolean(forked && spawned && forked !== spawned);
        parentThreadId = forked ?? spawned;
        return [];
      }
      if (row.type === "turn_context") {
        model = label(payload.model ?? object(payload.info)?.model) ?? model;
        provider = label(payload.model_provider) ?? provider;
        return [];
      }
      if (row.type !== "event_msg" || payload.type !== "token_count") return [];
      const info = object(payload.info);
      if (!info) return [];
      const total = tokens(info.total_token_usage);
      const last = tokens(info.last_token_usage);
      if (!total && !last) return [];
      const signature = digest([total, last]);
      const at = timestamp(row.timestamp);
      events.push({ signature, timestamp: at });
      const source = label(object(payload.rate_limits)?.limit_id) ?? "";
      const duplicate = Boolean(
        total && (signatureBySource.get(source) === signature || previousSignature === signature),
      );
      if (total) signatureBySource.set(source, signature);
      previousSignature = signature;
      let delta =
        last ??
        (total
          ? {
              input: Math.max(0, total.input - highWater.input),
              output: Math.max(0, total.output - highWater.output),
              read: Math.max(0, total.read - highWater.read),
              write: Math.max(0, total.write - highWater.write),
            }
          : highWater);
      if (total) {
        highWater = {
          input: Math.max(highWater.input, total.input),
          output: Math.max(highWater.output, total.output),
          read: Math.max(highWater.read, total.read),
          write: Math.max(highWater.write, total.write),
        };
      }
      let inherited = false;
      if (parentThreadId && options.parentSignatures && replayPrefix) {
        const found =
          at !== null && createdAt !== null && at <= createdAt
            ? options.parentSignatures.indexOf(signature, replayOffset)
            : -1;
        if (found >= 0) {
          inherited = true;
          replayOffset = found + 1;
        } else replayPrefix = false;
      }
      model = label(info.model ?? info.model_name ?? payload.model) ?? model;
      if (duplicate || !(delta.input || delta.output || delta.read || delta.write)) return [];
      if (
        inherited ||
        conflictingParent ||
        (parentThreadId && !options.parentSignatures) ||
        at === null
      )
        return [];
      // Codex cache counters are disjoint subsets of total input, not additional tokens.
      delta = { ...delta, read: Math.min(delta.read, delta.input) };
      delta.write = Math.min(delta.write, delta.input - delta.read);
      return [
        totalize({
          ...baseRecord("codex", identity("codex", sessionId, digest([at, signature])), at),
          providerId: provider,
          modelId: model,
          hasUsage: true,
          inputTokens: delta.input,
          outputTokens: delta.output,
          cacheReadTokens: delta.read,
          cacheCreationTokens: delta.write,
        }),
      ];
    },
  };
}
