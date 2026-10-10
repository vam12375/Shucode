import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppUsageRequest } from "@shucode/shared";
import { createExternalUsageService } from "../src/usage-stats/external/service.js";

const at = Date.parse("2026-01-01T10:00:00Z");
const row = (id: string) =>
  JSON.stringify({
    type: "message",
    id,
    timestamp: new Date(at).toISOString(),
    message: { role: "assistant", model: "fixture", usage: { input: 10, output: 2 } },
  }) + "\n";
const request = (syncSources = false): AppUsageRequest => ({
  range: "all",
  until: at + 1000,
  dashboard: { scope: "all-clients", syncSources },
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("external service owns one scan, throttles automatic sync and permits immediate manual sync", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shucode-usage-service-"));
  const path = join(dir, "session.jsonl");
  let now = 0;
  const service = createExternalUsageService({
    dbPath: ":memory:",
    sources: [{ id: "pi", label: "Pi", roots: [dir], kind: "jsonl" }],
    now: () => now,
  });
  try {
    await writeFile(path, row("one"));
    const first = await service.getDashboard(request());
    assert.equal(first.summary.requestCount, 1);
    assert.deepEqual(first.clientOptions, [{ id: "pi", label: "Pi", available: true }]);
    await appendFile(path, row("two"));
    now = 59_999;
    assert.equal((await service.getDashboard(request())).summary.requestCount, 1);
    now = 60_000;
    const simultaneous = await Promise.all(
      Array.from({ length: 4 }, () => service.getDashboard(request())),
    );
    assert.ok(
      simultaneous.every(
        (result) => result.summary.requestCount === 2 && result.sourceErrors.length === 0,
      ),
    );
    await appendFile(path, row("three"));
    assert.equal((await service.getDashboard(request())).summary.requestCount, 2);
    assert.equal((await service.getDashboard(request(true))).summary.requestCount, 3);
    assert.equal((await service.getDashboard(request())).summary.requestCount, 3);
  } finally {
    await service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing and corrupt sources keep imported historical totals with isolated source errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shucode-usage-service-"));
  const path = join(dir, "session.jsonl");
  const service = createExternalUsageService({
    dbPath: ":memory:",
    sources: [{ id: "pi", label: "Pi", roots: [dir], kind: "jsonl" }],
  });
  try {
    await writeFile(path, row("one"));
    await service.getDashboard(request());
    await writeFile(path, row("two") + "{malformed}\n" + row("three"));
    const corrupt = await service.getDashboard(request(true));
    assert.equal(corrupt.summary.requestCount, 1);
    assert.equal(corrupt.sourceErrors[0]?.clientId, "pi");
    assert.equal(corrupt.clientOptions[0]?.available, true);
    await rm(path);
    const missing = await service.getDashboard(request(true));
    assert.equal(missing.summary.requestCount, 1);
    assert.equal(missing.sourceErrors.length, 0);
    assert.equal(missing.clientOptions[0]?.available, true);
  } finally {
    await service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("dispose waits for pending open and rejects both its in-flight query and later queries", async () => {
  const opening = gate();
  const service = createExternalUsageService({
    dbPath: ":memory:",
    sources: [],
    beforeOpen: opening.promise,
  });
  const query = service.getDashboard(request());
  const rejected = assert.rejects(query, /disposed/);
  let complete = false;
  const disposing = service.dispose().then(() => {
    complete = true;
  });
  await Promise.resolve();
  assert.equal(complete, false);
  opening.resolve();
  await Promise.all([rejected, disposing]);
  assert.equal(complete, true);
  await assert.rejects(service.getDashboard(request()), /disposed/);
  await service.dispose();
});
