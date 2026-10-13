import { getShucodeCopy } from "@shucode/i18n";

/** headless 命令中心复用登录引导文案；原 TUI 侧可交互检查器随终端形态一并删除。 */
export function loginRequiredResponse(locale?: string): string {
  const copy = getShucodeCopy(locale).commandCenter.loginRequired;
  return [copy.message, copy.help].join("\n");
}
