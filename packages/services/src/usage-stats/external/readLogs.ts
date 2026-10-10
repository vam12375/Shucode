import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { zstdDecompressSync } from "node:zlib";
import { createRequire } from "node:module";

const MAX_LOG_LINE_BYTES = 16 * 1024 * 1024;
const MAX_COMPRESSED_LOG_BYTES = 128 * 1024 * 1024;
const decodeZstdFrame = zstdDecompressSync as unknown as (
  input: Uint8Array,
  options: { info: true },
) => { buffer: Buffer; engine: { bytesWritten: number } };

function parseLogLine(line: string): unknown {
  if (Buffer.byteLength(line) > MAX_LOG_LINE_BYTES)
    throw new Error("Client usage log line is too large");
  return JSON.parse(line);
}

async function* readZstdJsonLines(path: string): AsyncGenerator<unknown> {
  const compressed = await readFile(path);
  if (compressed.byteLength > MAX_COMPRESSED_LOG_BYTES)
    throw new Error("Compressed client usage log is too large");

  // DSH appends one independent Zstandard frame per event. Node's stream
  // decoder stops after the first frame, so walk the frame boundaries exposed
  // by the synchronous decoder and keep the same partial-tail behavior as the
  // regular JSONL reader.
  let offset = 0;
  let pending = "";
  while (offset < compressed.byteLength) {
    const decoded = decodeZstdFrame(compressed.subarray(offset), { info: true });
    const consumed = decoded.engine.bytesWritten;
    if (!Number.isSafeInteger(consumed) || consumed <= 0)
      throw new Error("Invalid Zstandard client usage log frame");
    offset += consumed;
    pending += decoded.buffer.toString("utf8");
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield parseLogLine(line);
    }
  }
  if (pending.trim()) {
    try {
      yield parseLogLine(pending);
    } catch (error) {
      // A writer can leave the final frame or JSON line incomplete. The next
      // scan sees a changed fingerprint and retries the complete file.
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
}

export async function* readUsageJsonLines(path: string): AsyncGenerator<unknown> {
  if (path.endsWith(".zstd")) {
    yield* readZstdJsonLines(path);
    return;
  }
  const file = createReadStream(path);
  const lines = createInterface({ input: file, crlfDelay: Infinity });
  let previous: string | undefined;
  try {
    // 最后一行可能仍在写入；只有能解析的完整 JSON 才消费，fingerprint 随下次 append 改变。
    for await (const line of lines) {
      if (previous?.trim()) {
        yield parseLogLine(previous);
      }
      previous = line;
    }
    if (previous?.trim()) {
      try {
        yield parseLogLine(previous);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
  } finally {
    lines.close();
    file.destroy();
  }
}

export async function* readOpenCodeUsage(path: string): AsyncGenerator<unknown> {
  const { DatabaseSync } = createRequire(import.meta.url)(
    "node:sqlite",
  ) as typeof import("node:sqlite");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = new Set(
      db
        .prepare("select name from sqlite_master where type='table'")
        .all()
        .map((row) => String(row.name)),
    );
    const table = tables.has("message")
      ? "message"
      : tables.has("opencode_message")
        ? "opencode_message"
        : null;
    if (!table) throw new Error("Unsupported OpenCode database schema");
    const columns = new Set(
      db
        .prepare(`pragma table_info(${table})`)
        .all()
        .map((row) => String(row.name)),
    );
    if (!columns.has("data") || !columns.has("id"))
      throw new Error("Unsupported OpenCode message schema");
    const session = columns.has("session_id") ? "session_id" : "null as session_id";
    const type = columns.has("type") ? "type" : "null as type";
    const sql = `select id, ${session}, ${type}, data from ${table} where id > ? order by id limit 500`;
    let cursor = "";
    for (;;) {
      const rows = db.prepare(sql).all(cursor);
      if (!rows.length) break;
      for (const row of rows) yield row;
      cursor = String(rows.at(-1)!.id);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    db.close();
  }
}
