import { buildRuntimeShucodeApiUrl, resolveZaiBusinessBaseUrl } from "@shucode/shared";

export const SHUCODE_CLIENT_SCENES_URL = buildRuntimeShucodeApiUrl(
  process.env,
  "/api/v1/client/scenes",
);

export const ZAI_API_HOST = resolveZaiBusinessBaseUrl(process.env);
