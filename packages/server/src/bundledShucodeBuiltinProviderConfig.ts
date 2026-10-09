import { materializeShucodeBuiltinProviderConfig } from "@shucode/services/node";

declare const __SHUCODE_BUILTIN_PROVIDER_CONFIG_JSON__: string | undefined;

interface MaterializeBundledShucodeBuiltinProviderConfigOptions {
  readonly environmentConfigRoot: string;
  readonly content: string;
}

/** 返回构建时嵌入远端 Server 的 Shucode Built-in Provider Config。 */
export function readBundledShucodeBuiltinProviderConfig(): string {
  if (typeof __SHUCODE_BUILTIN_PROVIDER_CONFIG_JSON__ !== "string") {
    throw new Error("当前构建未嵌入 Shucode Built-in Provider Config");
  }
  return __SHUCODE_BUILTIN_PROVIDER_CONFIG_JSON__;
}

/**
 * 将 Shucode Built-in Config 原子物化到所属环境的固定资源副本。
 * 升级前退出旧进程；不保留按内容 hash 增长的历史文件。
 */
export async function materializeBundledShucodeBuiltinProviderConfig(
  options: MaterializeBundledShucodeBuiltinProviderConfigOptions,
): Promise<string> {
  return materializeShucodeBuiltinProviderConfig(options);
}
