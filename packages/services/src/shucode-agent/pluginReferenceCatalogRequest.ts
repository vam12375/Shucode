import {
  shucodeProtocolMethods,
  shucodePluginsReferenceCatalogResultSchema,
  type ShucodePluginsReferenceCatalogParams,
} from "@shucode/shared";
import type { ShucodeProtocolClient } from "#src/shucode-agent/shucodeProtocolClient.js";

/** 旧协议严格校验响应；新展示字段走独立入口，只有 -32601 能证明旧 Agent 不支持。 */
export async function requestPluginReferenceCatalog(
  client: Pick<ShucodeProtocolClient, "request">,
  params: ShucodePluginsReferenceCatalogParams,
) {
  try {
    return await client.request(
      shucodeProtocolMethods.pluginsReferenceCatalogWithCategory,
      params,
      shucodePluginsReferenceCatalogResultSchema,
    );
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === -32601))
      throw error;
    return client.request(
      shucodeProtocolMethods.pluginsReferenceCatalog,
      params,
      shucodePluginsReferenceCatalogResultSchema,
    );
  }
}
