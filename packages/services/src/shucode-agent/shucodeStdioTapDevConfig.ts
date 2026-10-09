import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ShucodeStdioTapDevState } from "@shucode/shared";
import { getAppConfigDir } from "#src/paths.js";
import { isEffectiveDevelopmentNodeEnv } from "#src/runtime-tools/nodeEnv.js";

interface ShucodeStdioTapStateFile {
  enabled?: boolean;
}

function isShucodeStdioTapDevVisible(): boolean {
  return isEffectiveDevelopmentNodeEnv();
}

function getShucodeStdioTapDevDir(): string {
  return join(getAppConfigDir(), "dev");
}

export function getShucodeStdioTapDevLogDir(): string {
  return join(getShucodeStdioTapDevDir(), "stdio-traffic");
}

function getShucodeStdioTapDevStatePath(): string {
  return join(getShucodeStdioTapDevDir(), "shucode-stdio-tap.json");
}

function readStateFile(path: string): ShucodeStdioTapStateFile {
  if (!existsSync(path)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ShucodeStdioTapStateFile) : {};
  } catch {
    return {};
  }
}

export function readShucodeStdioTapDevState(): ShucodeStdioTapDevState {
  const visible = isShucodeStdioTapDevVisible();
  const statePath = getShucodeStdioTapDevStatePath();
  const fileState = readStateFile(statePath);
  return {
    enabled: visible && fileState.enabled === true,
    visible,
    logDir: getShucodeStdioTapDevLogDir(),
    statePath,
  };
}

export function setShucodeStdioTapDevEnabled(enabled: boolean): ShucodeStdioTapDevState {
  const visible = isShucodeStdioTapDevVisible();
  const statePath = getShucodeStdioTapDevStatePath();
  mkdirSync(getShucodeStdioTapDevDir(), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        // 开发态 stdio 抓包是高频原始协议帧，只能通过显式开关写旁路文件，避免误进生产日志。
        enabled: visible && enabled,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return readShucodeStdioTapDevState();
}
