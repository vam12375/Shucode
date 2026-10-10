import { opendir, stat, lstat } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

export interface UsageSourceRoot {
  id: string;
  label: string;
  roots: string[];
  kind: "jsonl" | "json" | "dsh" | "sqlite";
}
export interface UsageSourceFile {
  path: string;
  fingerprint: string;
  root: UsageSourceRoot;
}

export function defaultUsageRoots(home = homedir()): UsageSourceRoot[] {
  const envPath = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
  const codex = envPath("CODEX_HOME", join(home, ".codex"));
  const dsh = envPath("DSH_HOME", join(home, ".dsh"));
  const data = envPath("XDG_DATA_HOME", join(home, ".local", "share"));
  return [
    {
      id: "codex",
      label: "Codex",
      roots: [join(codex, "sessions"), join(codex, "archived_sessions")],
      kind: "jsonl",
    },
    {
      id: "claude-code",
      label: "Claude Code",
      roots: [join(envPath("CLAUDE_CONFIG_DIR", join(home, ".claude")), "projects")],
      kind: "jsonl",
    },
    {
      id: "pi",
      label: "Pi",
      roots: [join(envPath("PI_CODING_AGENT_DIR", join(home, ".pi", "agent")), "sessions")],
      kind: "jsonl",
    },
    {
      id: "dsh-desktop",
      label: "DSH Desktop",
      roots: [join(dsh, "sessions"), join(home, ".dsh-beta", "sessions")],
      kind: "dsh",
    },
    { id: "gemini", label: "Gemini CLI", roots: [join(home, ".gemini", "tmp")], kind: "json" },
    {
      id: "opencode",
      label: "OpenCode",
      roots: [join(data, "opencode", "opencode.db")],
      kind: "sqlite",
    },
    {
      id: "grok-build",
      label: "Grok Build",
      roots: [join(home, ".grok", "sessions"), join(home, ".grok", "archived_sessions")],
      kind: "jsonl",
    },
  ];
}

export function isMissingSource(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function* walk(root: string, depth = 0): AsyncGenerator<string> {
  const info = await lstat(root);
  if (info.isSymbolicLink()) return;
  if (info.isFile()) {
    yield root;
    return;
  }
  if (!info.isDirectory()) return;
  if (depth > 12) throw new Error("Client log directory exceeds supported nesting");
  const directory = await opendir(root);
  for await (const entry of directory) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* walk(path, depth + 1);
    else if (entry.isFile()) yield path;
  }
}

function isSessionFile(path: string, source: UsageSourceRoot): boolean {
  const name = basename(path);
  if (source.kind === "dsh") return /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(name);
  if (source.kind === "sqlite") return name === "opencode.db";
  if (source.id === "grok-build") return name === "updates.jsonl";
  if (source.id === "gemini")
    return /^session-.*\.jsonl?$/.test(name) && basename(dirname(path)) === "chats";
  return name.endsWith(".jsonl");
}

export async function listUsageFiles(source: UsageSourceRoot): Promise<UsageSourceFile[]> {
  const files: UsageSourceFile[] = [];
  for (const root of new Set(source.roots)) {
    try {
      for await (const path of walk(root)) {
        if (!isSessionFile(path, source)) continue;
        const info = await stat(path);
        let fingerprint = `${info.mtimeMs}:${info.size}`;
        if (source.kind === "sqlite") {
          try {
            const wal = await stat(`${path}-wal`);
            fingerprint += `:${wal.mtimeMs}:${wal.size}`;
          } catch (error) {
            if (!isMissingSource(error)) throw error;
          }
        }
        files.push({ path, fingerprint, root: source });
      }
    } catch (error) {
      if (!isMissingSource(error)) throw error;
    }
  }
  if (source.kind !== "dsh") return files;
  // DSH 会发布新 generation 同时保留旧版本；同一会话只读取最高版本。
  const latest = new Map<string, UsageSourceFile>();
  const generation = (path: string) => Number(basename(path).match(/\.v(\d+)\./)?.[1] ?? 0);
  for (const file of files) {
    const previous = latest.get(dirname(file.path));
    if (
      !previous ||
      generation(file.path) > generation(previous.path) ||
      (generation(file.path) === generation(previous.path) && file.path.endsWith(".zstd"))
    )
      latest.set(dirname(file.path), file);
  }
  return [...latest.values()];
}
