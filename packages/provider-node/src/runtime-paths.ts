export const SHUCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV = "SHUCODE_BUILTIN_PROVIDER_CONFIG_FILE";
export const SHUCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV =
  "SHUCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE";
export const SHUCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV = "SHUCODE_PERSONAL_PROVIDER_CONFIG_FILE";
export const PERSONAL_PROVIDER_CONFIG_FILE_NAME = "provider_config.json";

export interface NodeProviderRuntimePaths {
  readonly shucodeBuiltinFilePath: string;
  readonly personalFilePath: string;
}

export function createNodeProviderRuntimePathEnv(
  paths: NodeProviderRuntimePaths,
): Record<string, string> {
  return {
    [SHUCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: paths.shucodeBuiltinFilePath,
    [SHUCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: paths.personalFilePath,
  };
}

export function resolveNodeProviderRuntimePaths(
  env: Readonly<Record<string, string | undefined>>,
): NodeProviderRuntimePaths | null {
  const shucodeBuiltinFilePath = env[SHUCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const personalFilePath = env[SHUCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  if (!shucodeBuiltinFilePath && !personalFilePath) return null;
  if (!shucodeBuiltinFilePath || !personalFilePath) {
    throw new Error("Shucode Built-in 与 Personal Provider Config 路径必须同时提供");
  }
  return Object.freeze({ shucodeBuiltinFilePath, personalFilePath });
}
