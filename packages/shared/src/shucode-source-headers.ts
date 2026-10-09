import { DEFAULT_SHUCODE_ENDPOINT_ORIGIN } from "./shucodeEndpoint.js";

export const SHUCODE_SOURCE_HEADERS = {
  "User-Agent": "ZCode/unknown",
  "HTTP-Referer": DEFAULT_SHUCODE_ENDPOINT_ORIGIN,
  "X-Title": "Z Code@electron",
} as const;

export interface BuildShucodeSourceHeadersFromContextOptions {
  appVersion?: string;
  arch?: string;
  clientLanguage?: string;
  clientTimezone?: string;
  deviceMid?: string;
  endpointOrigin?: string;
  osVersion?: string;
  platform?: string;
  releaseChannel?: string;
  sourceTitle?: string;
}

export function normalizeShucodeSourceHeaderValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[\x20-\x7e]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function buildShucodeSourceHeadersFromContext(
  options: BuildShucodeSourceHeadersFromContextOptions = {},
): Record<string, string> {
  const appVersion = normalizeShucodeSourceHeaderValue(options.appVersion);
  const arch = normalizeShucodeSourceHeaderValue(options.arch);
  const clientLanguage = normalizeShucodeSourceHeaderValue(options.clientLanguage) ?? "unknown";
  const clientTimezone = normalizeShucodeSourceHeaderValue(options.clientTimezone) ?? "unknown";
  const deviceMid = normalizeShucodeSourceHeaderValue(options.deviceMid);
  const endpointOrigin =
    normalizeShucodeSourceHeaderValue(options.endpointOrigin) ?? DEFAULT_SHUCODE_ENDPOINT_ORIGIN;
  const osVersion = normalizeShucodeSourceHeaderValue(options.osVersion);
  const platform = normalizeShucodeSourceHeaderValue(options.platform);
  const releaseChannel = normalizeShucodeSourceHeaderValue(options.releaseChannel);
  const sourceTitle = normalizeShucodeSourceHeaderValue(options.sourceTitle) ?? "electron";

  return {
    ...SHUCODE_SOURCE_HEADERS,
    "HTTP-Referer": endpointOrigin,
    "User-Agent": `ZCode/${appVersion ?? "unknown"}`,
    ...(appVersion ? { "X-Shucode-App-Version": appVersion } : {}),
    "X-Title": `Z Code@${sourceTitle}`,
    ...(platform && arch ? { "X-Platform": `${platform}-${arch}` } : {}),
    ...(releaseChannel ? { "X-Release-Channel": releaseChannel } : {}),
    "X-Client-Language": clientLanguage,
    "X-Client-Timezone": clientTimezone,
    ...(platform ? { "X-Os-Category": normalizeOsCategory(platform) } : {}),
    ...(osVersion ? { "X-Os-Version": osVersion } : {}),
    ...(deviceMid ? { "X-Device-Mid": deviceMid } : {}),
  };
}

function normalizeOsCategory(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}
