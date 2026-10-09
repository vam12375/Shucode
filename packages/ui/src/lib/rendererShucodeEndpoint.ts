import {
  buildRuntimeShucodeEndpointUrls,
  SHUCODE_ENV,
  type RuntimeShucodeEndpointEnv,
} from "@shucode/shared";

interface RendererImportMetaEnv {
  VITE_SHUCODE_BASE_URL?: string;
  VITE_SHUCODE_ENDPOINT_ORIGIN?: string;
}

function readRendererImportMetaEnv(): RendererImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: RendererImportMetaEnv }).env ??
    {}) as RendererImportMetaEnv;
}

function createRendererShucodeEndpointEnv(
  env: RendererImportMetaEnv = readRendererImportMetaEnv(),
): RuntimeShucodeEndpointEnv {
  return {
    SHUCODE_ENV,
    // UI 侧的 shucode-plan 占位 provider 以前只看 SHUCODE_ENV，
    // 没有消费 Vite 注入的 base url，导致自定义测试域名时 renderer 和 host/service 可能不一致。
    SHUCODE_BASE_URL: env.VITE_SHUCODE_BASE_URL,
    SHUCODE_ENDPOINT_ORIGIN: env.VITE_SHUCODE_ENDPOINT_ORIGIN,
  };
}

export const RENDERER_SHUCODE_ENDPOINT_URLS = buildRuntimeShucodeEndpointUrls(
  createRendererShucodeEndpointEnv(),
);
