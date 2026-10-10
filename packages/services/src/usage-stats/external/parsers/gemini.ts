import type { ExternalUsageRecord } from "../types.js";
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

export function parseGeminiSession(value: unknown, fileKey: string): ExternalUsageRecord[] {
  const session = object(value);
  if (!Array.isArray(session?.messages)) return [];
  const sessionId = label(session.sessionId) ?? fileKey;
  const records: ExternalUsageRecord[] = [];
  for (const value of session.messages) {
    const message = object(value);
    const tokens = object(message?.tokens);
    const at = timestamp(message?.timestamp);
    if (
      message?.type !== "gemini" ||
      at === null ||
      !hasCounters(tokens, ["input", "output", "thoughts", "cached"])
    )
      continue;
    const model = label(message.model);
    const input = count(tokens?.input);
    const output = count(tokens?.output) + count(tokens?.thoughts);
    const read = Math.min(input, count(tokens?.cached));
    const id = label(message.id) ?? digest([at, model, input, output, read]);
    records.push(
      totalize({
        ...baseRecord("gemini", identity("gemini", sessionId, id), at),
        providerId: label(message.provider),
        modelId: model,
        hasUsage: true,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: read,
      }),
    );
  }
  return records;
}
