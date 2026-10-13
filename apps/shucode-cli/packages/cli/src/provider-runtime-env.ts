import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  NodeShucodeBuiltinProviderConfigSource,
  PERSONAL_PROVIDER_CONFIG_FILE_NAME,
  resolveShucodeBuiltinCachePaths,
  resolveShucodeBuiltinClientPlatform,
  SHUCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV,
  SHUCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV,
  SHUCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV,
  type ShucodeBuiltinRefreshEvent,
} from "@shucode/provider-node";
import { resolveRuntimeShucodeEndpointOrigin, SHUCODE_VERSION } from "@shucode/shared";
import type { CliEnv } from "./env.js";

export function createCliProviderRefreshReporter(
  stderr: Pick<NodeJS.WriteStream, "write"> = process.stderr,
) {
  return {
    onBuiltinRefreshError(error: unknown) {
      stderr.write(
        `Shucode Built-in 刷新失败: ${error instanceof Error ? error.message : "unknown error"}\n`,
      );
    },
    onBuiltinRefreshResult(event: ShucodeBuiltinRefreshEvent) {
      // TTL 检查不是生产事件；成功更新才默认留痕，不能输出 CDN URL 查询参数或内容。
      if (event.result === "updated" || process.env.NODE_ENV !== "production") {
        stderr.write(
          `Shucode Built-in ${event.result}${event.reason ? ` (${event.reason})` : ""}${event.revision === undefined ? "" : ` revision=${event.revision} source=CDN`}\n`,
        );
      }
    },
  };
}

interface PrepareCliProviderRuntimeEnvOptions {
  readonly argv: readonly string[];
  readonly env: CliEnv;
  readonly dataBaseDir?: string;
  readonly entrypoint?: string;
  readonly appVersion?: string;
  readonly platform?: string;
}

/** 为运行 Core 或写入模型选择的 CLI Entry 定位同一 Environment 的 Provider Config。 */
export async function prepareCliProviderRuntimeEnv(
  options: PrepareCliProviderRuntimeEnvOptions,
): Promise<Record<string, string>> {
  if (!requiresProviderRuntime(options.argv)) return {};

  const explicitShucodeBuiltin = options.env[SHUCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const explicitPersonal = options.env[SHUCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const dataBaseDir = options.dataBaseDir ?? options.env.SHUCODE_DATA_BASE_DIR?.trim() ?? homedir();
  if (explicitShucodeBuiltin && explicitPersonal) {
    return {
      [SHUCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: explicitShucodeBuiltin,
      [SHUCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: explicitPersonal,
    };
  }

  const shucodeBuiltinFilePath =
    explicitShucodeBuiltin ??
    (await resolveBundledShucodeBuiltinProviderConfig({
      entrypoint: options.entrypoint ?? process.argv[1],
    }));
  const personalFilePath =
    explicitPersonal ?? join(dataBaseDir, ".shucode", "v2", PERSONAL_PROVIDER_CONFIG_FILE_NAME);
  const appVersion = options.appVersion ?? SHUCODE_VERSION;
  const platform = options.platform ?? resolveShucodeBuiltinClientPlatform();
  const shucodeEndpointOrigin = resolveRuntimeShucodeEndpointOrigin(options.env);
  const cachePaths = resolveShucodeBuiltinCachePaths({
    environmentConfigRoot: join(dataBaseDir, ".shucode", "v2"),
    platform,
    appVersion,
    shucodeEndpointOrigin,
  });
  const source = new NodeShucodeBuiltinProviderConfigSource({
    bundledFilePath: shucodeBuiltinFilePath,
    activeFilePath: cachePaths.activeFilePath,
    watch: false,
  });
  // 入口只准备资源和路径；下载由 Prompt 长生命周期 Runtime 持有并取消。
  try {
    await source.read();
  } finally {
    source.dispose();
  }

  return {
    [SHUCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: cachePaths.activeFilePath,
    [SHUCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV]: shucodeBuiltinFilePath,
    [SHUCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: personalFilePath,
  };
}

function requiresProviderRuntime(argv: readonly string[]): boolean {
  if (argv.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v")) {
    return false;
  }
  if (
    argv.some(
      (arg) =>
        arg === "--prompt" ||
        arg.startsWith("--prompt=") ||
        arg === "--target" ||
        arg.startsWith("--target="),
    )
  ) {
    return true;
  }

  const command = argv[0];
  if (command === undefined || command.startsWith("-")) return true;
  return (
    command === "app-server" ||
    command === "agent-server" ||
    command === "login" ||
    command === "logout"
  );
}

async function resolveBundledShucodeBuiltinProviderConfig(input: {
  readonly entrypoint: string | undefined;
}): Promise<string> {
  const entrypoint = input.entrypoint?.trim();
  if (!entrypoint) throw new Error("无法定位 CLI Shucode Built-in Provider Config：缺少入口路径");
  // 全局 bin 可以是软链接，随包配置必须相对真实入口定位。
  const entryDirectory = dirname(realpathSync(resolve(entrypoint)));
  const candidates = [
    join(entryDirectory, "provider", "shucode-builtin.json"),
    resolve(entryDirectory, "../../../../../config/provider/shucode-builtin.json"),
  ];
  const candidate = candidates.find((filePath) => existsSync(filePath));
  if (candidate) return candidate;
  throw new Error(`无法定位 CLI Shucode Built-in Provider Config：${candidates.join(", ")}`);
}
