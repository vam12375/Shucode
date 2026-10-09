import type { UiLocale, SupportedLocale } from "@shucode/contracts";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";
import {
  DEFAULT_LOCALE,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./locale.js";
import type { ShucodeCopy } from "./types.js";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
};
export type { LocaleDetectionInput } from "./locale.js";
export type { CliCopy, TuiCopy, UiLocale, SupportedLocale, ShucodeCopy } from "./types.js";

const CATALOGS: Record<SupportedLocale, ShucodeCopy> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

export function getShucodeCopy(locale?: UiLocale | string, detected?: string | null): ShucodeCopy {
  return CATALOGS[resolveLocale(locale, detected)];
}
