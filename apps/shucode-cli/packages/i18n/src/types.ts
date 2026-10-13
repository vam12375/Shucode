import type { SupportedLocale } from "@shucode/contracts";

export type { SupportedLocale, UiLocale } from "@shucode/contracts";

export interface ShucodeCopy {
  cli: CliCopy;
  locale: SupportedLocale;
  commandCenter: CommandCenterCopy;
}

export interface CliCopy {
  errors: {
    localeUnsupported(value: string): string;
  };
  help(version: string): string;
}

/**
 * 命令中心文案（原 TUI 文案迁移）：仅保留 headless 命令中心仍在消费的子树；
 * 其余随终端形态下线删除。见 specs/cli/terminal-surface-removal.md。
 */
export interface CommandCenterCopy {
  effort: {
    disabled: string;
    enabled: string;
  };
  loginRequired: {
    help: string;
    message: string;
  };
  loginSetup: {
    emptyMessage: string;
    help: string;
    options: {
      bigmodelApiKey: {
        inputPrimary: string;
        inputSecondary: string;
        primary: string;
        secondary: string;
      };
      bigmodelOauth: {
        pendingPrimary: string;
        pendingSecondary: string;
        primary: string;
        secondary: string;
      };
      zaiApiKey: {
        inputPrimary: string;
        inputSecondary: string;
        primary: string;
        secondary: string;
      };
      zaiOauth: {
        pendingPrimary: string;
        pendingSecondary: string;
        primary: string;
        secondary: string;
      };
    };
    pending: {
      cancelStatus: string;
      help: string;
      status: string;
    };
    input: {
      cancelStatus: string;
      clearStatus: string;
      emptyStatus: string;
      help: string;
      placeholder: string;
      status: string;
      submitStatus: string;
    };
    prompt: string;
    response: string;
    title: string;
  };
}
