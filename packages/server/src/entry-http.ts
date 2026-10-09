import { createLocalServices, getAppConfigDir } from "@shucode/services/node";
import {
  materializeBundledShucodeBuiltinProviderConfig,
  readBundledShucodeBuiltinProviderConfig,
} from "./bundledShucodeBuiltinProviderConfig.js";
import { createHttpServer } from "./http.js";

async function main(): Promise<void> {
  const shucodeBuiltinProviderConfigFilePath = await materializeBundledShucodeBuiltinProviderConfig(
    {
      environmentConfigRoot: getAppConfigDir(),
      content: readBundledShucodeBuiltinProviderConfig(),
    },
  );
  const port = Number(process.env["PORT"]) || 3030;
  const host =
    process.env["SHUCODE_SERVER_HOST"]?.trim() || process.env["HOST"]?.trim() || undefined;
  const staticRoot = process.env["SHUCODE_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["SHUCODE_SERVER_AUTH_TOKEN"]?.trim() || undefined;
  const services = createLocalServices({
    shucodeBuiltinProviderConfigFilePath,
    providerProvisioningTargetEnabled: Boolean(authToken),
  });

  createHttpServer(services, port, {
    ...(host ? { host } : {}),
    ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
    ...(authToken ? { authToken, authRequired: true } : {}),
  });
}

void main().catch((error: unknown) => {
  console.error("[shucode-server:http] startup failed", error);
  process.exitCode = 1;
});
