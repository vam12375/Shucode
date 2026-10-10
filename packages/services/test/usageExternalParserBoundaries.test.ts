import assert from "node:assert/strict";
import test from "node:test";
import {
  createClaudeParser,
  createCodexParser,
  createDshParser,
  createGrokParser,
  createPiParser,
  parseDshSession,
  parseOpenCodeMessage,
} from "../src/usage-stats/external/parsers/index.js";

const at = Date.parse("2026-10-10T10:00:00Z");

test("Codex stable ids survive unrelated row insertions and cache counters stay within input", () => {
  const token = {
    type: "event_msg",
    timestamp: new Date(at).toISOString(),
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 10,
          output_tokens: 2,
          cached_input_tokens: 8,
          cache_write_input_tokens: 7,
          reasoning_output_tokens: 1,
        },
      },
    },
  };
  const collect = (extra: unknown[] = []) => {
    const parser = createCodexParser("file");
    parser.consume({ type: "session_meta", payload: { id: "session" } });
    for (const row of extra) parser.consume(row);
    return parser.consume(token)[0];
  };
  const first = collect();
  assert.equal(
    first?.id,
    collect([{ type: "response_item", payload: { type: "message", content: "private-fixture" } }])
      ?.id,
  );
  assert.equal(first?.inputTokens, 10);
  assert.equal(first?.cacheReadTokens, 8);
  assert.equal(first?.cacheCreationTokens, 2);
  assert.equal(first?.outputTokens, 2);
});

test("DSH two-pass streaming seed metadata preserves inherited routing but not inherited usage", () => {
  const parser = createDshParser("file", { seedCut: 2 });
  parser.consume({ type: "session", version: 4, id: "child", isSeeded: true });
  parser.consume({
    type: "request/context",
    seq: 0,
    time: at,
    data: { provider: "route", model: "model" },
  });
  assert.deepEqual(
    parser.consume({
      type: "assistant/message",
      seq: 1,
      time: at,
      data: { turn: 1, step: 1, usage: { inputTokens: 100 } },
    }),
    [],
  );
  parser.consume({ type: "session/end-seed", seq: 2, time: at, data: { inherited: true } });
  parser.consume({ type: "step/start", seq: 3, time: at, data: { turn: 2, step: 1 } });
  const record = parser.consume({
    type: "assistant/message",
    seq: 4,
    time: at + 1,
    data: { turn: 2, step: 1, usage: { inputTokens: 5, outputTokens: 1 } },
  })[0];
  assert.equal(record?.providerId, "route");
  assert.equal(record?.inputTokens, 5);
  assert.equal(record?.durationMs, 1);
});

test("DSH future formats and forks without a proven cut fail, no usage cancelled steps remain visible", () => {
  assert.throws(
    () => createDshParser("file").consume({ type: "session", version: 5 }),
    /Unsupported/,
  );
  assert.throws(
    () => createDshParser("file").consume({ type: "session", version: 4, isSeeded: true }),
    /boundary/,
  );
  const records = parseDshSession(
    [
      { type: "session", version: 4, id: "s", isSeeded: false },
      { type: "step/start", seq: 0, time: at, data: { turn: 1, step: 1 } },
      { type: "turn/end", seq: 1, time: at + 1, data: { turn: 1, reason: { kind: "aborted" } } },
    ],
    "file",
  );
  assert.equal(records[0]?.status, "cancelled");
  assert.equal(records[0]?.hasUsage, false);
  assert.equal(records[0]?.nativeCostUSD, null);
});

test("OpenCode V2 compaction type can come from its SQLite row", () => {
  const record = parseOpenCodeMessage(
    {
      id: "id",
      session_id: "session",
      type: "compaction",
      data: {
        status: "completed",
        model: { id: "model", providerID: "provider" },
        tokens: { input: 1, output: 2, cache: { read: 3, write: 4 } },
        time: { created: at },
      },
    },
    "file",
  )[0];
  assert.equal(record?.status, "completed");
  assert.equal(record?.inputTokens, 8);
  assert.equal(record?.providerId, "provider");
});

test("Grok partial reported cost is unknown and intermediate usage is skipped", () => {
  const parser = createGrokParser("session");
  const row = {
    method: "_x.ai/session/update",
    timestamp: at / 1000,
    params: {
      update: {
        sessionUpdate: "turn_completed",
        prompt_id: "id",
        usage: { inputTokens: 10, outputTokens: 2, costUsdTicks: 10, costIsPartial: true },
      },
    },
  };
  assert.equal(parser.consume(row)[0]?.nativeCostUSD, null);
  assert.deepEqual(
    parser.consume({
      ...row,
      params: { update: { ...row.params.update, sessionUpdate: "usage_updated" } },
    }),
    [],
  );
});

test("Claude copied sessions share provider message identity", () => {
  const row = {
    type: "assistant",
    sessionId: "copy-a",
    timestamp: new Date(at).toISOString(),
    message: {
      id: "provider-message",
      model: "model",
      usage: { input_tokens: 10, output_tokens: 2 },
    },
  };
  const first = createClaudeParser("file-a").consume(row)[0];
  const second = createClaudeParser("file-b").consume({ ...row, sessionId: "copy-b" })[0];
  assert.equal(first?.id, second?.id);
});

test("Pi copied entries share explicit entry identity while id-less fallback remains session scoped", () => {
  const row = {
    type: "message",
    id: "provider-entry",
    timestamp: new Date(at).toISOString(),
    message: { role: "assistant", model: "model", usage: { input: 10, output: 2 } },
  };
  const first = createPiParser("file-a").consume(row)[0];
  const second = createPiParser("file-b").consume({ ...row })[0];
  assert.equal(first?.id, second?.id);
  const withoutId = { ...row, id: undefined };
  assert.notEqual(
    createPiParser("file-a").consume(withoutId)[0]?.id,
    createPiParser("file-b").consume(withoutId)[0]?.id,
  );
});

test("Codex fork keeps root identity and does not confuse later equal usage with inherited data", () => {
  const event = (time: number) => ({
    type: "event_msg",
    timestamp: new Date(time).toISOString(),
    payload: {
      type: "token_count",
      info: { last_token_usage: { input_tokens: 10, output_tokens: 2 } },
    },
  });
  const parent = createCodexParser("parent-file");
  parent.consume(event(at));
  const parser = createCodexParser("child-file", {
    parentSignatures: parent.getReplayInfo().tokenEvents.map((event) => event.signature),
  });
  parser.consume({
    type: "session_meta",
    timestamp: new Date(at).toISOString(),
    payload: { id: "child", forked_from_id: "parent" },
  });
  parser.consume({
    type: "session_meta",
    timestamp: new Date(at - 1).toISOString(),
    payload: { id: "parent" },
  });
  const own = parser.consume(event(at + 1))[0];
  assert.equal(own?.inputTokens, 10);
  assert.equal(parser.getReplayInfo().sessionId, "child");
  assert.equal(parser.getReplayInfo().parentThreadId, "parent");
});

test("DSH failed attempt uses request route recorded after the step starts", () => {
  const records = parseDshSession(
    [
      { type: "session", version: 4, id: "session" },
      { type: "step/start", seq: 0, time: at, data: { turn: 1, step: 1 } },
      {
        type: "request/header",
        seq: 1,
        time: at + 1,
        data: { header: { config: { provider: "route", model: "model" } } },
      },
      {
        type: "assistant/attempt",
        seq: 2,
        time: at + 2,
        data: {
          turn: 1,
          step: 1,
          stream: [
            { type: "chunk", time: at + 2, chunk: { type: "usage", usage: { inputTokens: 10 } } },
          ],
        },
      },
      { type: "turn/end", seq: 3, time: at + 3, data: { turn: 1, reason: { kind: "error" } } },
    ],
    "file",
  );
  assert.equal(records[0]?.providerId, "route");
  assert.equal(records[0]?.modelId, "model");
  assert.equal(records[0]?.status, "error");
  assert.equal(records[0]?.retryCount, 0);
});

test("Claude API failure without usage is a terminal unpriced call", () => {
  const parser = createClaudeParser("file");
  const row = parser.consume({
    type: "assistant",
    timestamp: new Date(at).toISOString(),
    isApiErrorMessage: true,
    message: { id: "failed-call", model: "model", content: "private-fixture" },
  })[0];
  assert.equal(row?.status, "error");
  assert.equal(row?.hasUsage, false);
  assert.equal(row?.totalTokens, 0);
  assert.ok(!JSON.stringify(row).includes("private-fixture"));
});
