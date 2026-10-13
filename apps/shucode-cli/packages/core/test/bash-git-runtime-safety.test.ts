import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clearGitRuntimeSafetyCache,
  isGitRuntimeContextUnsafe,
} from "../src/tool/handlers/bash-git-runtime-safety.js";

function makeTempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "shucode-git-safety-"));
}

function makeTrustedGitDirectory(repo: string): void {
  const dotGit = join(repo, ".git");
  mkdirSync(join(dotGit, "objects"), { recursive: true });
  mkdirSync(join(dotGit, "refs"), { recursive: true });
  writeFileSync(join(dotGit, "HEAD"), "ref: refs/heads/main\n");
}

test("plain git worktree classifies as safe", () => {
  clearGitRuntimeSafetyCache();
  const repo = makeTempWorkspace();
  makeTrustedGitDirectory(repo);
  assert.equal(isGitRuntimeContextUnsafe({ workingDirectory: repo }), false);
  rmSync(repo, { recursive: true, force: true });
});

test("directory without git metadata classifies as safe", () => {
  clearGitRuntimeSafetyCache();
  const dir = makeTempWorkspace();
  assert.equal(isGitRuntimeContextUnsafe({ workingDirectory: dir }), false);
  rmSync(dir, { recursive: true, force: true });
});

test("bare repo layout (HEAD without .git) classifies as unsafe", () => {
  clearGitRuntimeSafetyCache();
  const dir = makeTempWorkspace();
  writeFileSync(join(dir, "HEAD"), "ref: refs/heads/main\n");
  mkdirSync(join(dir, "objects"), { recursive: true });
  assert.equal(isGitRuntimeContextUnsafe({ workingDirectory: dir }), true);
  rmSync(dir, { recursive: true, force: true });
});

test(".git file redirecting back into the workspace classifies as unsafe", () => {
  clearGitRuntimeSafetyCache();
  const dir = makeTempWorkspace();
  writeFileSync(join(dir, ".git"), "gitdir: .git-real\n");
  mkdirSync(join(dir, ".git-real"), { recursive: true });
  writeFileSync(join(dir, ".git-real", "HEAD"), "ref: refs/heads/main\n");
  assert.equal(isGitRuntimeContextUnsafe({ workingDirectory: dir }), true);
  rmSync(dir, { recursive: true, force: true });
});

test("unresolvable working directory classifies as unsafe", () => {
  clearGitRuntimeSafetyCache();
  const dir = join(makeTempWorkspace(), "does-not-exist");
  assert.equal(isGitRuntimeContextUnsafe({ workingDirectory: dir }), true);
});

test("verdict is memoized until the cache is cleared", () => {
  clearGitRuntimeSafetyCache();
  const dir = makeTempWorkspace();
  makeTrustedGitDirectory(dir);
  assert.equal(isGitRuntimeContextUnsafe({ workingDirectory: dir }), false);

  // 分类后把结构变成裸仓库:缓存有效期内沿用旧结论。
  rmSync(join(dir, ".git"), { recursive: true, force: true });
  writeFileSync(join(dir, "HEAD"), "ref: refs/heads/main\n");
  assert.equal(isGitRuntimeContextUnsafe({ workingDirectory: dir }), false);

  // 失效后必须重新分类并看到新结构。
  clearGitRuntimeSafetyCache();
  assert.equal(isGitRuntimeContextUnsafe({ workingDirectory: dir }), true);
  rmSync(dir, { recursive: true, force: true });
});
