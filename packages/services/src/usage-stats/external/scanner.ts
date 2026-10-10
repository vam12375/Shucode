import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { ExternalUsageLedger } from "./ledger.js";
import { readOpenCodeUsage, readUsageJsonLines } from "./readLogs.js";
import { listUsageFiles, type UsageSourceFile, type UsageSourceRoot } from "./sourceFiles.js";
import type { ExternalJsonlParser, ExternalSourceStatus, ExternalUsageRecord } from "./types.js";
import {
  createClaudeParser,
  createCodexParser,
  createDshParser,
  createGrokParser,
  createPiParser,
  parseGeminiSession,
  parseOpenCodeMessage,
  type CodexReplayInfo,
} from "./parsers/index.js";

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const fileKey = (file: UsageSourceFile) =>
  createHash("sha256")
    .update(
      `${file.root.id}:${
        file.root.id === "grok-build"
          ? basename(dirname(file.path))
          : file.root.kind === "dsh"
            ? dirname(file.path)
            : file.path
      }`,
    )
    .digest("hex");

async function codexInfo(file: UsageSourceFile, full: boolean): Promise<CodexReplayInfo> {
  const parser = createCodexParser(fileKey(file));
  for await (const row of readUsageJsonLines(file.path)) {
    parser.consume(row);
    if (!full && object(row)?.type === "session_meta") break;
  }
  return parser.getReplayInfo();
}

async function dshSeedCut(file: UsageSourceFile): Promise<number | undefined> {
  let cut: number | undefined;
  for await (const value of readUsageJsonLines(file.path)) {
    const row = object(value);
    if (
      row?.type === "session/end-seed" &&
      object(row.data)?.inherited === true &&
      Number.isSafeInteger(row.seq)
    )
      cut = row.seq as number;
  }
  return cut;
}

async function createParser(
  file: UsageSourceFile,
  codexFiles: ReadonlyMap<string, UsageSourceFile>,
): Promise<ExternalJsonlParser> {
  const key = fileKey(file);
  switch (file.root.id) {
    case "codex": {
      const info = await codexInfo(file, false);
      if (!info.parentThreadId) return createCodexParser(key);
      const parent = codexFiles.get(info.parentThreadId);
      if (!parent || info.createdAt === null || parent.path === file.path)
        throw new Error("Codex inherited usage boundary unavailable");
      const replay = await codexInfo(parent, true);
      if (
        replay.maxTimestamp === null ||
        replay.maxTimestamp < info.createdAt ||
        replay.tokenEvents.some((event) => event.timestamp === null)
      )
        throw new Error("Codex inherited usage boundary unavailable");
      return createCodexParser(key, {
        parentSignatures: replay.tokenEvents
          .filter((event) => event.timestamp !== null && event.timestamp <= info.createdAt!)
          .map((event) => event.signature),
      });
    }
    case "claude-code":
      return createClaudeParser(key);
    case "pi":
      return createPiParser(key);
    case "grok-build":
      return createGrokParser(key);
    case "dsh-desktop":
      return createDshParser(key, { seedCut: await dshSeedCut(file) });
    default:
      throw new Error("Unsupported client usage source");
  }
}

async function* records(
  file: UsageSourceFile,
  codexFiles: ReadonlyMap<string, UsageSourceFile>,
): AsyncGenerator<ExternalUsageRecord[]> {
  if (file.root.kind === "sqlite") {
    for await (const row of readOpenCodeUsage(file.path))
      yield parseOpenCodeMessage(row, fileKey(file));
    return;
  }
  if (file.root.kind === "json") {
    // Gemini 的会话格式是单个 JSON 文档，限制大小后才解析。
    if ((await stat(file.path)).size > 64 * 1024 * 1024)
      throw new Error("Client session is too large");
    const raw = await readFile(file.path, "utf8");
    yield parseGeminiSession(JSON.parse(raw), fileKey(file));
    return;
  }
  const parser = await createParser(file, codexFiles);
  for await (const row of readUsageJsonLines(file.path)) yield parser.consume(row);
  if ("requiresParent" in parser && parser.requiresParent)
    throw new Error("Codex inherited usage boundary unavailable");
}

export async function scanExternalUsage(
  ledger: ExternalUsageLedger,
  sources: readonly UsageSourceRoot[],
): Promise<ExternalSourceStatus[]> {
  const statuses: ExternalSourceStatus[] = [];
  for (const source of sources) {
    try {
      const files = await listUsageFiles(source);
      const codexFiles = new Map<string, UsageSourceFile>();
      let failures = 0;
      let boundaryMissing = false;
      const conflictingParents = new Set<string>();
      if (source.id === "codex")
        for (const file of files) {
          try {
            const info = await codexInfo(file, false);
            const duplicate = codexFiles.get(info.sessionId);
            if (duplicate) {
              const copies = await Promise.all([codexInfo(duplicate, true), codexInfo(file, true)]);
              const left = copies[0].tokenEvents;
              const right = copies[1].tokenEvents;
              // 归档副本可少一个 append 尾部；不一致的父时间线不能作为 fork 去重证据。
              if (
                !left
                  .slice(0, Math.min(left.length, right.length))
                  .every(
                    (event, index) =>
                      event.signature === right[index]?.signature &&
                      event.timestamp === right[index]?.timestamp,
                  )
              )
                conflictingParents.add(info.sessionId);
              else if (right.length > left.length) codexFiles.set(info.sessionId, file);
            } else codexFiles.set(info.sessionId, file);
          } catch {
            failures++;
          }
        }
      for (const id of conflictingParents) codexFiles.delete(id);
      for (const file of files) {
        const key = fileKey(file);
        if (ledger.getFileFingerprint(key) === file.fingerprint) continue;
        try {
          ledger.beginFileScan();
          let batch: ExternalUsageRecord[] = [];
          for await (const rows of records(file, codexFiles)) {
            batch.push(...rows);
            if (batch.length >= 500) {
              ledger.stageFileRecords(batch);
              batch = [];
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
          }
          ledger.stageFileRecords(batch);
          ledger.commitFileScan(key, file.fingerprint);
        } catch (error) {
          ledger.abortFileScan();
          failures++;
          boundaryMissing ||=
            error instanceof Error && error.message.includes("inherited usage boundary");
        }
      }
      statuses.push({
        id: source.id,
        label: source.label,
        available: files.length > 0 || ledger.hasClientData(source.id),
        ...(failures
          ? {
              error: boundaryMissing
                ? "Some forked sessions are awaiting their original usage logs"
                : `Unable to import ${failures} client usage files`,
            }
          : {}),
      });
    } catch {
      statuses.push({
        id: source.id,
        label: source.label,
        available: ledger.hasClientData(source.id),
        error: "Unable to read client usage source",
      });
    }
  }
  return statuses;
}
