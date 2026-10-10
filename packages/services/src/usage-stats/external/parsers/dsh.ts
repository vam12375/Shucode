import type { ExternalJsonlParser, ExternalUsageRecord } from "../types.js";
import {
  baseRecord,
  count,
  elapsed,
  hasCounters,
  identity,
  label,
  object,
  timestamp,
  totalize,
} from "./helpers.js";

interface Step {
  record: ExternalUsageRecord;
  turn: number;
  start: number | null;
  settledAt: number | null;
  message: ExternalUsageRecord | null;
  messagePresent: boolean;
  attempts: ExternalUsageRecord[];
  interrupted: boolean;
  ended: boolean;
}

function usageRecord(value: unknown): ExternalUsageRecord | null {
  const usage = object(value);
  if (!hasCounters(usage, ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]))
    return null;
  const read = count(usage?.cacheReadTokens);
  const write = count(usage?.cacheWriteTokens);
  return totalize({
    ...baseRecord("dsh-desktop", "", 0),
    hasUsage: true,
    inputTokens: count(usage?.inputTokens) + read + write,
    outputTokens: count(usage?.outputTokens),
    cacheReadTokens: read,
    cacheCreationTokens: write,
  });
}

function streamUsage(stream: unknown): ExternalUsageRecord | null {
  if (!Array.isArray(stream)) return null;
  let usage: ExternalUsageRecord | null = null;
  for (const value of stream) {
    const record = object(value);
    const chunk = object(record?.chunk);
    if (record?.type === "chunk" && chunk?.type === "usage")
      usage = usageRecord(chunk.usage) ?? usage;
  }
  return usage;
}

function project(step: Step, turnReason?: string): ExternalUsageRecord | null {
  const status = step.interrupted
    ? "cancelled"
    : step.ended && step.messagePresent
      ? "completed"
      : !step.messagePresent && turnReason === "error"
        ? "error"
        : !step.messagePresent && (turnReason === "aborted" || turnReason === "interrupted")
          ? "cancelled"
          : "unknown";
  const usages = [...step.attempts, ...(step.message ? [step.message] : [])];
  if (!usages.length && status === "unknown") return null;
  const record = {
    ...step.record,
    status,
    retryCount: Math.max(0, step.record.retryCount - (step.messagePresent ? 0 : 1)),
    durationMs: elapsed(step.start, step.settledAt),
  };
  for (const usage of usages) {
    record.inputTokens += usage.inputTokens;
    record.outputTokens += usage.outputTokens;
    record.cacheReadTokens += usage.cacheReadTokens;
    record.cacheCreationTokens += usage.cacheCreationTokens;
    record.hasUsage = true;
  }
  return totalize(record);
}

/** seedCut is the last inherited event sequence (inclusive), discovered before scanning. */
export function createDshParser(
  fileKey: string,
  options: { seedCut?: number } = {},
): ExternalJsonlParser {
  let sessionId = fileKey;
  let seedCut = options.seedCut ?? -1;
  const steps = new Map<string, Step>();
  const seenSeq = new Set<number>();
  let provider: string | null = null;
  let model: string | null = null;
  let activeStep: Step | undefined;
  const turnReasons = new Map<number, string>();
  return {
    consume(value) {
      const row = object(value);
      if (!row) return [];
      if (row.type === "session") {
        if (
          !Number.isInteger(row.version) ||
          (row.version as number) < 0 ||
          (row.version as number) > 4
        )
          throw new Error("Unsupported DSH session format");
        sessionId = label(row.id) ?? sessionId;
        if ((row.version as number) <= 1) seedCut = count(row.seedLength) - 1;
        else if (row.isSeeded === true && options.seedCut === undefined)
          throw new Error("DSH inherited usage boundary unavailable");
        return [];
      }
      const data = object(row.data);
      const at = timestamp(row.time);
      if (!data || at === null || !Number.isSafeInteger(row.seq) || (row.seq as number) < 0)
        return [];
      if (seenSeq.has(row.seq as number)) return [];
      seenSeq.add(row.seq as number);
      if (row.type === "request/header") {
        const config = object(object(data.header)?.config);
        provider = label(config?.provider) ?? provider;
        model = label(config?.model) ?? model;
        // request/header 位于 step/start 后，失败 attempt 也需要保留已确认的实际路由。
        if (activeStep) {
          activeStep.record.providerId = provider;
          activeStep.record.modelId = model;
        }
        return [];
      }
      if (row.type === "request/context") {
        provider = label(data.provider) ?? provider;
        model = label(data.model) ?? model;
        if (activeStep) {
          activeStep.record.providerId = provider;
          activeStep.record.modelId = model;
        }
        return [];
      }
      if ((row.seq as number) <= seedCut) return [];
      if (row.type === "turn/end") {
        const turn = count(data.turn);
        const reason = label(object(data.reason)?.kind) ?? "unknown";
        turnReasons.set(turn, reason);
        return [...steps.values()]
          .filter((step) => step.turn === turn)
          .flatMap((step) => {
            const record = project(step, reason);
            return record ? [record] : [];
          });
      }
      if (!Number.isSafeInteger(data.turn) || !Number.isSafeInteger(data.step)) return [];
      if (
        !["step/start", "step/end", "assistant/message", "assistant/attempt"].includes(
          row.type as string,
        )
      )
        return [];
      const key = `${data.turn}:${data.step}`;
      let step = steps.get(key);
      if (!step) {
        step = {
          record: {
            ...baseRecord("dsh-desktop", identity("dsh-desktop", sessionId, key), at),
            providerId: provider,
            modelId: model,
          },
          turn: data.turn as number,
          start: null,
          settledAt: null,
          message: null,
          messagePresent: false,
          attempts: [],
          interrupted: false,
          ended: false,
        };
        steps.set(key, step);
      }
      if (row.type === "step/start") {
        step.start = at;
        step.record.startedAt = at;
        activeStep = step;
      } else if (row.type === "step/end") {
        step.ended = true;
        if (activeStep === step) activeStep = undefined;
      } else if (row.type === "assistant/message") {
        const source = object(object(data.message)?.source);
        step.record.providerId = label(source?.provider) ?? provider;
        step.record.modelId = label(source?.model) ?? model;
        // message usage 与其 stream 内的 usage 是同一事实，优先顶层而不累加。
        step.message = usageRecord(data.usage) ?? streamUsage(data.stream);
        step.messagePresent = true;
        step.settledAt = at;
        step.interrupted = data.interrupted === true;
      } else if (row.type === "assistant/attempt") {
        const usage = streamUsage(data.stream);
        if (usage) step.attempts.push(usage);
        step.record.retryCount += 1;
        step.settledAt = at;
      }
      const record = project(step, turnReasons.get(step.turn));
      return record ? [record] : [];
    },
  };
}

export function parseDshSession(rows: readonly unknown[], fileKey: string): ExternalUsageRecord[] {
  let seedCut: number | undefined;
  for (const value of rows) {
    const row = object(value);
    if (
      row?.type === "session/end-seed" &&
      object(row.data)?.inherited === true &&
      Number.isSafeInteger(row.seq)
    )
      seedCut = row.seq as number;
  }
  const parser = createDshParser(fileKey, { seedCut });
  const records = new Map<string, ExternalUsageRecord>();
  for (const row of rows) for (const record of parser.consume(row)) records.set(record.id, record);
  return [...records.values()];
}
