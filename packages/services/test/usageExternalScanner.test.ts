import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zstdCompressSync } from "node:zlib";
import { ExternalUsageLedger } from "../src/usage-stats/external/ledger.js";
import { scanExternalUsage } from "../src/usage-stats/external/scanner.js";
import type { UsageSourceRoot } from "../src/usage-stats/external/sourceFiles.js";

const at = Date.parse("2026-01-01T10:00:00Z");
const jsonl = (rows: readonly unknown[]) =>
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
const pi = (id: string) => ({
  type: "message",
  id,
  timestamp: new Date(at).toISOString(),
  message: { role: "assistant", model: "fixture", usage: { input: 10, output: 2 } },
});
const codex = (time: number, total: number, last: number) => ({
  type: "event_msg",
  timestamp: new Date(time).toISOString(),
  payload: {
    type: "token_count",
    info: {
      total_token_usage: { input_tokens: total, output_tokens: total / 10 },
      last_token_usage: { input_tokens: last, output_tokens: last / 10 },
    },
  },
});
async function fixture(id = "pi", kind: UsageSourceRoot["kind"] = "jsonl") {
  const dir = await mkdtemp(join(tmpdir(), "shucode-usage-scan-"));
  const ledger = new ExternalUsageLedger(":memory:");
  const source: UsageSourceRoot = { id, label: id, roots: [dir], kind };
  return {
    dir,
    ledger,
    source,
    query: () =>
      ledger.query({ range: "all", until: at + 60_000, dashboard: { scope: "all-clients" } }),
    scan: () => scanExternalUsage(ledger, [source]),
    async dispose() {
      ledger.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("partial JSONL tail retries after completion and copied entries remain idempotent", async () => {
  const f = await fixture();
  try {
    const path = join(f.dir, "session.jsonl");
    const second = JSON.stringify(pi("second"));
    const split = Math.floor(second.length / 2);
    await writeFile(path, jsonl([pi("first")]) + second.slice(0, split));
    assert.equal((await f.scan())[0]?.error, undefined);
    assert.equal(f.query().summary.requestCount, 1);
    await appendFile(path, second.slice(split) + "\n");
    await f.scan();
    assert.equal(f.query().summary.requestCount, 2);
    await writeFile(join(f.dir, "copied.jsonl"), jsonl([pi("first"), pi("second")]));
    await f.scan();
    await f.scan();
    assert.equal(f.query().summary.requestCount, 2);
  } finally {
    await f.dispose();
  }
});

test("malformed middle line aborts more than one staged batch and corrected file can retry", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dir, "existing.jsonl"), jsonl([pi("existing")]));
    await f.scan();
    const rows = Array.from({ length: 1001 }, (_, index) => pi(`bulk-${index}`));
    const path = join(f.dir, "bulk.jsonl");
    await writeFile(path, jsonl(rows.slice(0, 1000)) + "{malformed}\n" + jsonl(rows.slice(1000)));
    assert.match((await f.scan())[0]?.error ?? "", /Unable to import/);
    assert.equal(f.query().summary.requestCount, 1);
    await writeFile(path, jsonl(rows));
    assert.equal((await f.scan())[0]?.error, undefined);
    assert.equal(f.query().summary.requestCount, 1002);
  } finally {
    await f.dispose();
  }
});

test("DSH chooses highest compressed generation and excludes seeded usage", async () => {
  const f = await fixture("dsh-desktop", "dsh");
  try {
    const header = { type: "session", version: 4, id: "session", isSeeded: true };
    const event = (seq: number, type: string, data: unknown) => ({
      seq,
      type,
      time: at + seq,
      data,
    });
    const message = (turn: number, inputTokens: number) => ({
      turn,
      step: 1,
      usage: { inputTokens, outputTokens: 1 },
    });
    await writeFile(
      join(f.dir, "session.jsonl"),
      jsonl([{ ...header, isSeeded: false }, event(0, "assistant/message", message(1, 900))]),
    );
    await writeFile(
      join(f.dir, "session.v2.jsonl"),
      jsonl([{ ...header, isSeeded: false }, event(0, "assistant/message", message(1, 800))]),
    );
    const latest = [
      header,
      event(0, "assistant/message", message(1, 700)),
      event(1, "session/end-seed", { inherited: true }),
      event(2, "step/start", { turn: 2, step: 1 }),
      event(3, "assistant/message", message(2, 5)),
      event(4, "step/end", { turn: 2, step: 1 }),
      event(5, "turn/end", { turn: 2, reason: { kind: "completed" } }),
    ];
    await writeFile(
      join(f.dir, "session.v2.jsonl.zstd"),
      Buffer.concat([
        // DSH appends independent frames, so a session can span many frames.
        zstdCompressSync(Buffer.from(jsonl(latest.slice(0, 3)))),
        zstdCompressSync(Buffer.from(jsonl(latest.slice(3)))),
      ]),
    );
    assert.equal((await f.scan())[0]?.error, undefined);
    assert.equal(f.query().summary.requestCount, 1);
    assert.equal(f.query().summary.inputTokens, 5);
    assert.equal(f.query().logs[0]?.status, "completed");
  } finally {
    await f.dispose();
  }
});

test("Codex fork waits for original logs then counts only new usage", async () => {
  const f = await fixture("codex");
  try {
    const inherited = codex(at, 100, 100);
    const own = codex(at + 20, 130, 30);
    await writeFile(
      join(f.dir, "child.jsonl"),
      jsonl([
        {
          type: "session_meta",
          timestamp: new Date(at + 10).toISOString(),
          payload: { id: "child", forked_from_id: "parent" },
        },
        {
          type: "session_meta",
          timestamp: new Date(at - 1).toISOString(),
          payload: { id: "parent" },
        },
        inherited,
        own,
      ]),
    );
    assert.match((await f.scan())[0]?.error ?? "", /original usage logs/);
    assert.equal(f.query().summary.requestCount, 0);
    await writeFile(
      join(f.dir, "parent.jsonl"),
      jsonl([
        {
          type: "session_meta",
          timestamp: new Date(at - 1).toISOString(),
          payload: { id: "parent" },
        },
        inherited,
        {
          type: "event_msg",
          timestamp: new Date(at + 11).toISOString(),
          payload: { type: "task_complete" },
        },
      ]),
    );
    assert.equal((await f.scan())[0]?.error, undefined);
    assert.equal(f.query().summary.requestCount, 2);
    assert.equal(f.query().summary.inputTokens, 130);
    await f.scan();
    assert.equal(f.query().summary.requestCount, 2);
  } finally {
    await f.dispose();
  }
});

test("Grok archived copies share session identity and deleting sources retains history", async () => {
  const f = await fixture("grok-build");
  try {
    const active = join(f.dir, "active", "session-id");
    const archived = join(f.dir, "archived", "session-id");
    await mkdir(active, { recursive: true });
    await mkdir(archived, { recursive: true });
    const row = {
      method: "_x.ai/session/update",
      timestamp: at / 1000,
      params: {
        update: {
          sessionUpdate: "turn_completed",
          prompt_id: "prompt",
          usage: { inputTokens: 10, outputTokens: 2 },
        },
      },
    };
    await writeFile(join(active, "updates.jsonl"), jsonl([row]));
    await f.scan();
    await writeFile(join(archived, "updates.jsonl"), jsonl([row]));
    await f.scan();
    assert.equal(f.query().summary.requestCount, 1);
    await rm(active, { recursive: true });
    await rm(archived, { recursive: true });
    assert.equal((await f.scan())[0]?.available, true);
    assert.equal(f.query().summary.requestCount, 1);
  } finally {
    await f.dispose();
  }
});

test("Claude copied partial files cannot downgrade completed provider message facts", async () => {
  const f = await fixture("claude-code");
  try {
    const row = (output: number, stopReason?: string) => ({
      type: "assistant",
      sessionId: `copy-${output}`,
      timestamp: new Date(at).toISOString(),
      message: {
        id: "provider-message",
        model: "fixture",
        usage: { input_tokens: 10, output_tokens: output },
        ...(stopReason ? { stop_reason: stopReason } : {}),
      },
    });
    await writeFile(join(f.dir, "final.jsonl"), jsonl([row(100, "end_turn")]));
    await f.scan();
    const partial = join(f.dir, "partial.jsonl");
    await writeFile(partial, jsonl([row(1)]));
    await f.scan();
    assert.equal(f.query().summary.requestCount, 1);
    assert.equal(f.query().summary.outputTokens, 100);
    assert.equal(f.query().logs[0]?.status, "completed");
    await appendFile(partial, jsonl([row(2)]));
    await f.scan();
    assert.equal(f.query().summary.outputTokens, 100);
    await writeFile(join(f.dir, "earlier-final.jsonl"), jsonl([row(50, "end_turn")]));
    await f.scan();
    assert.equal(f.query().summary.outputTokens, 100);
    await writeFile(partial, jsonl([row(200, "end_turn")]));
    await f.scan();
    assert.equal(f.query().summary.outputTokens, 200);
  } finally {
    await f.dispose();
  }
});

test("Gemini scans chat session JSON only and retains input/output thought normalization", async () => {
  const f = await fixture("gemini", "json");
  try {
    const chats = join(f.dir, "project-id", "chats");
    await mkdir(chats, { recursive: true });
    const session = {
      sessionId: "session-id",
      messages: [
        {
          id: "message-id",
          type: "gemini",
          timestamp: new Date(at).toISOString(),
          model: "fixture",
          tokens: { input: 100, output: 10, thoughts: 5, cached: 80 },
        },
      ],
    };
    await writeFile(join(chats, "session-id.json"), JSON.stringify(session));
    await writeFile(
      join(f.dir, "session-other.json"),
      JSON.stringify({ ...session, sessionId: "ignored-root" }),
    );
    await writeFile(join(chats, "settings.json"), "{malformed}");
    assert.equal((await f.scan())[0]?.error, undefined);
    assert.equal(f.query().summary.requestCount, 1);
    assert.equal(f.query().summary.inputTokens, 100);
    assert.equal(f.query().summary.outputTokens, 15);
    assert.equal(f.query().summary.cacheReadTokens, 80);
    await f.scan();
    assert.equal(f.query().summary.requestCount, 1);
  } finally {
    await f.dispose();
  }
});

test("OpenCode V2 SQLite scans optional message type across read-only batches", async () => {
  const f = await fixture("opencode", "sqlite");
  const { DatabaseSync } = createRequire(import.meta.url)(
    "node:sqlite",
  ) as typeof import("node:sqlite");
  const db = new DatabaseSync(join(f.dir, "opencode.db"));
  try {
    db.exec(
      "create table opencode_message(id text primary key, session_id text, type text, data text)",
    );
    const insert = db.prepare("insert into opencode_message values(?,?,?,?)");
    for (let index = 0; index < 501; index++) {
      insert.run(
        `message-${String(index).padStart(4, "0")}`,
        "session",
        "compaction",
        JSON.stringify({
          status: "completed",
          model: { id: "fixture", providerID: "fixture-provider" },
          time: { created: at },
          tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 5, write: 3 } },
        }),
      );
    }
    const before = db.prepare("pragma data_version").get();
    assert.equal((await f.scan())[0]?.error, undefined);
    assert.equal(f.query().summary.requestCount, 501);
    assert.equal(f.query().summary.inputTokens, 501 * 18);
    assert.equal(f.query().summary.outputTokens, 501 * 3);
    assert.equal(f.query().logs[0]?.providerId, "fixture-provider");
    assert.deepEqual(db.prepare("pragma data_version").get(), before);
    await f.scan();
    assert.equal(f.query().summary.requestCount, 501);
  } finally {
    db.close();
    await f.dispose();
  }
});
