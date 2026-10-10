import assert from "node:assert/strict";
import test from "node:test";
import {
  createClaudeParser,
  createCodexParser,
  createGrokParser,
  createPiParser,
  parseDshSession,
  parseGeminiSession,
  parseOpenCodeMessage,
} from "../src/usage-stats/external/parsers/index.js";

const time = "2026-10-10T10:00:00.000Z";
const timestamp = Date.parse(time);
const tokenEvent = (total: number, last?: number, limitId = "primary") => ({
  type: "event_msg",
  timestamp: time,
  payload: {
    type: "token_count",
    info: {
      total_token_usage: { input_tokens: total, output_tokens: total / 10 },
      ...(last === undefined
        ? {}
        : { last_token_usage: { input_tokens: last, output_tokens: last / 10 } }),
    },
    rate_limits: { limit_id: limitId },
  },
});

test("Codex prefers per-call usage, suppresses repeated snapshots, and preserves high water", () => {
  const parser = createCodexParser("file");
  parser.consume({
    type: "session_meta",
    timestamp: time,
    payload: { id: "session", model_provider: "custom" },
  });
  parser.consume({ type: "turn_context", payload: { model: "test-model" } });
  assert.equal(parser.consume(tokenEvent(100, 100))[0]?.inputTokens, 100);
  assert.deepEqual(parser.consume(tokenEvent(100, 100, "other")), []);
  assert.equal(parser.consume(tokenEvent(150, 80))[0]?.inputTokens, 80);
  assert.deepEqual(parser.consume(tokenEvent(120)), []);
  const next = parser.consume(tokenEvent(170))[0];
  assert.equal(next?.inputTokens, 20);
  assert.equal(next?.providerId, "custom");
  assert.equal(next?.modelId, "test-model");
  assert.equal(next?.status, "unknown");
});

test("Codex explicit parent requires evidence and inherited usage is never counted", () => {
  const parent = createCodexParser("parent-file");
  parent.consume({ type: "session_meta", timestamp: time, payload: { id: "parent" } });
  parent.consume(tokenEvent(100, 100));
  const header = {
    type: "session_meta",
    timestamp: time,
    payload: { id: "child", forked_from_id: "parent" },
  };
  const unresolved = createCodexParser("child-file");
  unresolved.consume(header);
  assert.equal(unresolved.requiresParent, true);
  assert.deepEqual(unresolved.consume(tokenEvent(100, 100)), []);
  const child = createCodexParser("child-file", {
    parentSignatures: parent.getReplayInfo().tokenEvents.map((event) => event.signature),
  });
  child.consume(header);
  assert.deepEqual(child.consume(tokenEvent(100, 100)), []);
  const own = child.consume(tokenEvent(130, 30))[0];
  assert.equal(own?.inputTokens, 30);
  assert.equal(
    own?.id,
    createCodexParserResultId(
      header,
      tokenEvent(100, 100),
      tokenEvent(130, 30),
      parent.getReplayInfo().tokenEvents.map((event) => event.signature),
    ),
  );
});

function createCodexParserResultId(
  header: unknown,
  inherited: unknown,
  own: unknown,
  signatures: string[],
) {
  const parser = createCodexParser("child-file", { parentSignatures: signatures });
  parser.consume(header);
  parser.consume(inherited);
  return parser.consume(own)[0]?.id;
}

test("Claude merges message blocks under one id and normalizes fresh input", () => {
  const parser = createClaudeParser("file");
  const row = (output: number, reason?: string) => ({
    type: "assistant",
    sessionId: "session",
    timestamp: time,
    message: {
      id: "message",
      model: "model",
      content: "private-text",
      usage: {
        input_tokens: 10,
        output_tokens: output,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 5,
      },
      stop_reason: reason,
    },
  });
  const first = parser.consume(row(1))[0];
  const final = parser.consume(row(8, "end_turn"))[0];
  assert.equal(first?.id, final?.id);
  assert.equal(final?.inputTokens, 35);
  assert.equal(final?.totalTokens, 43);
  assert.equal(final?.status, "completed");
  assert.equal(final?.providerId, null);
  assert.deepEqual(parser.consume(row(2)), []);
  assert.ok(!JSON.stringify(final).includes("private-text"));
});

test("Pi extracts assistant and compaction usage, retains zero cost, and ignores nested usage", () => {
  const parser = createPiParser("file");
  parser.consume({ type: "session", id: "session", timestamp: time });
  const records = parser.consume({
    type: "message",
    id: "one",
    timestamp: time,
    message: {
      role: "assistant",
      provider: "provider",
      model: "model",
      responseModel: "actual",
      stopReason: "stop",
      content: "private-text",
      usage: {
        input: 10,
        output: 7,
        cacheRead: 5,
        cacheWrite: 2,
        reasoning: 3,
        totalTokens: 999,
        cost: { total: 0 },
      },
    },
  });
  assert.equal(records[0]?.inputTokens, 17);
  assert.equal(records[0]?.outputTokens, 7);
  assert.equal(records[0]?.modelId, "actual");
  assert.equal(records[0]?.nativeCostUSD, 0);
  assert.ok(!JSON.stringify(records).includes("private-text"));
  const compact = parser.consume({
    type: "compaction",
    id: "compact",
    timestamp: time,
    summary: "private-text",
    usage: { input: 2, output: 3 },
    details: { retainedTail: records },
  });
  assert.equal(compact.length, 1);
  assert.equal(compact[0]?.providerId, null);
  assert.deepEqual(
    parser.consume({ type: "message", message: { role: "user", usage: { input: 99 } } }),
    [],
  );
});

test("Pi errors without usage stay unpriced and invalid token types are rejected", () => {
  const parser = createPiParser("file");
  const row = parser.consume({
    type: "message",
    id: "err",
    timestamp: time,
    message: { role: "assistant", stopReason: "error", errorMessage: "private-error" },
  })[0];
  assert.equal(row?.status, "error");
  assert.equal(row?.hasUsage, false);
  assert.equal(row?.nativeCostUSD, null);
  const invalid = parser.consume({
    type: "message",
    id: "bad",
    timestamp: time,
    message: { role: "assistant", usage: { input: "42", output: -1 } },
  });
  assert.deepEqual(invalid, []);
});

test("Gemini output and thoughts are separate and input already includes cache", () => {
  const records = parseGeminiSession(
    {
      sessionId: "s",
      messages: [
        {
          type: "gemini",
          id: "m",
          timestamp: time,
          model: "model",
          tokens: { input: 100, output: 10, thoughts: 5, cached: 80 },
          content: "private-text",
        },
      ],
    },
    "file",
  );
  assert.equal(records[0]?.inputTokens, 100);
  assert.equal(records[0]?.outputTokens, 15);
  assert.equal(records[0]?.totalTokens, 115);
  assert.equal(records[0]?.providerId, null);
  assert.ok(!JSON.stringify(records).includes("private-text"));
});

test("OpenCode parses SQL and legacy shapes, includes reasoning and cache exactly once", () => {
  const value = {
    role: "assistant",
    modelID: "model",
    providerID: "provider",
    tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 6, write: 4 } },
    cost: 0,
    time: { created: timestamp, completed: timestamp + 1000 },
  };
  const sql = parseOpenCodeMessage(
    { id: "m", session_id: "s", data: JSON.stringify(value) },
    "file",
  )[0];
  const old = parseOpenCodeMessage({ id: "m", sessionID: "s", ...value }, "file")[0];
  assert.equal(sql?.id, old?.id);
  assert.equal(sql?.inputTokens, 20);
  assert.equal(sql?.outputTokens, 7);
  assert.equal(sql?.nativeCostUSD, 0);
  assert.equal(sql?.durationMs, 1000);
  assert.equal(sql?.status, "completed");
  assert.equal(sql?.providerId, "provider");
});

test("Grok per-turn values are not cumulatively differenced and reasoning is output subset", () => {
  const parser = createGrokParser("session");
  const row = (id: string) => ({
    method: "_x.ai/session/update",
    timestamp: timestamp / 1000,
    params: {
      update: {
        sessionUpdate: "turn_completed",
        prompt_id: id,
        usage: {
          modelUsage: {
            model: {
              inputTokens: 100,
              outputTokens: 20,
              cachedReadTokens: 60,
              reasoningTokens: 8,
              costUsdTicks: 0,
            },
          },
        },
      },
    },
  });
  const one = parser.consume(row("one"))[0];
  const two = parser.consume(row("two"))[0];
  assert.equal(one?.inputTokens, 100);
  assert.equal(two?.inputTokens, 100);
  assert.equal(one?.outputTokens, 20);
  assert.equal(one?.nativeCostUSD, 0);
  assert.notEqual(one?.id, two?.id);
  assert.equal(one?.providerId, null);
});

test("DSH selects current session seed cut and extracts actual message route without text", () => {
  const event = (seq: number, type: string, data: unknown) => ({
    seq,
    type,
    time: timestamp + seq * 10,
    data,
  });
  const message = {
    turn: 1,
    step: 1,
    message: {
      source: { kind: "model", provider: "provider", model: "model" },
      content: "private-text",
    },
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 20,
      cacheWriteTokens: 2,
      reasoningTokens: 3,
    },
  };
  const records = parseDshSession(
    [
      { type: "session", version: 4, id: "child", createdAt: timestamp, isSeeded: true },
      event(0, "assistant/message", message),
      event(1, "session/end-seed", { inherited: true }),
      event(2, "step/start", { turn: 2, step: 1 }),
      event(3, "assistant/message", { ...message, turn: 2 }),
      event(4, "step/end", { turn: 2, step: 1 }),
      event(5, "turn/end", { turn: 2, reason: { kind: "completed" } }),
    ],
    "file",
  );
  assert.equal(records.length, 1);
  assert.equal(records[0]?.inputTokens, 32);
  assert.equal(records[0]?.outputTokens, 5);
  assert.equal(records[0]?.status, "completed");
  assert.equal(records[0]?.providerId, "provider");
  assert.equal(records[0]?.durationMs, 10);
  assert.ok(!JSON.stringify(records).includes("private-text"));
});

test("DSH attempts retain stream usage without duplicating message usage and support legacy seedLength", () => {
  const records = parseDshSession(
    [
      { type: "session", version: 1, id: "s", createdAt: timestamp, seedLength: 1 },
      {
        type: "assistant/message",
        seq: 0,
        time: timestamp,
        data: { turn: 1, step: 1, usage: { inputTokens: 999 } },
      },
      { type: "step/start", seq: 1, time: timestamp, data: { turn: 2, step: 1 } },
      {
        type: "assistant/attempt",
        seq: 2,
        time: timestamp + 5,
        data: {
          turn: 2,
          step: 1,
          stream: [
            {
              type: "chunk",
              time: timestamp + 4,
              chunk: { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } },
            },
          ],
        },
      },
      {
        type: "assistant/message",
        seq: 3,
        time: timestamp + 10,
        data: {
          turn: 2,
          step: 1,
          usage: { inputTokens: 20, outputTokens: 3 },
          stream: [
            {
              type: "chunk",
              time: timestamp + 9,
              chunk: { type: "usage", usage: { inputTokens: 20, outputTokens: 3 } },
            },
          ],
        },
      },
      {
        type: "turn/end",
        seq: 4,
        time: timestamp + 15,
        data: { turn: 2, reason: { kind: "error" } },
      },
    ],
    "file",
  );
  assert.equal(records.length, 1);
  assert.equal(
    records.reduce((sum, record) => sum + record.inputTokens, 0),
    30,
  );
  assert.equal(records[0]?.status, "unknown");
  assert.equal(records[0]?.retryCount, 1);
});
