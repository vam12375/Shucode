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

export function createGrokParser(fileKey: string): ExternalJsonlParser {
  return {
    consume(value) {
      const row = object(value);
      if (row?.method !== "_x.ai/session/update") return [];
      const update = object(object(row.params)?.update);
      if (update?.sessionUpdate !== "turn_completed") return [];
      const usage = object(update.usage);
      const rawTime = row?.timestamp;
      const at = timestamp(
        rawTime,
        typeof rawTime === "number" && rawTime < 1e11 ? "seconds" : "ms",
      );
      if (!usage || at === null) return [];
      const perModel = object(usage.modelUsage);
      const entries =
        perModel && Object.keys(perModel).length
          ? Object.entries(perModel)
          : [[null, usage] as const];
      return entries.flatMap(([model, value]) => {
        const counters = object(value);
        if (!hasCounters(counters, ["inputTokens", "outputTokens", "cachedReadTokens"])) return [];
        const input = count(counters?.inputTokens);
        const output = count(counters?.outputTokens);
        const read = Math.min(input, count(counters?.cachedReadTokens));
        const id = label(update.prompt_id) ?? digest([at, model, input, output, read]);
        const ticks = finite(counters?.costUsdTicks);
        const partial = usage.costIsPartial === true || counters?.costIsPartial === true;
        return [
          totalize({
            ...baseRecord(
              "grok-build",
              identity("grok-build", fileKey, `${id}:${model ?? "unknown"}`),
              at,
            ),
            modelId: label(model),
            providerId: label(counters?.provider),
            hasUsage: true,
            querySource: "external-turn-aggregate",
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: read,
            durationMs: finite(counters?.apiDurationMs),
            nativeCostUSD: ticks !== null && !partial ? ticks / 1e10 : null,
          }),
        ];
      });
    },
  };
}
