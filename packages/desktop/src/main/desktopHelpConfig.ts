import { net } from "electron";
import {
  buildHelpAppConfigUrl,
  buildShucodeSourceHeadersFromContext,
  createHelpAppConfigReader,
  SHUCODE_ENV,
} from "@shucode/shared";

export function createDesktopHelpConfigReader(options: {
  resolveEndpointOrigin: () => Promise<string>;
  appVersion: string;
  deviceMid: string;
}) {
  const read = createHelpAppConfigReader({
    // reader 的 fetchImpl 类型是 typeof fetch（可含 URL 入参），electron net.fetch 只收
    // string | Request；在包装层归一化，不改变 reader 的公开签名。
    fetchImpl: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
  });
  return async () => {
    const endpointOrigin = await options.resolveEndpointOrigin();
    return read(
      buildHelpAppConfigUrl(
        endpointOrigin,
        options.appVersion,
        `${process.platform}-${process.arch}`,
      ),
      buildShucodeSourceHeadersFromContext({
        endpointOrigin,
        appVersion: options.appVersion,
        deviceMid: options.deviceMid,
        platform: process.platform,
        arch: process.arch,
        releaseChannel: SHUCODE_ENV,
        sourceTitle: "electron",
      }),
    );
  };
}
