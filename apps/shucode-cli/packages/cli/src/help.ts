import { getShucodeCopy, type SupportedLocale, type UiLocale } from "@shucode/i18n";

export function formatCliHelp(
  version: string,
  locale?: UiLocale,
  detectedLocale?: SupportedLocale,
): string {
  return getShucodeCopy(locale, detectedLocale).cli.help(version);
}
