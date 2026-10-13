import type { PromptInput, SubmitPromptResult } from "./interaction-types.js";
import type { CommandCenterApp, CommandCenterDeps } from "./types.js";

export function normalizePromptInput(input: PromptInput): Exclude<PromptInput, string> {
  if (typeof input === "string") return { text: input };
  return input;
}

export function attachCurrentSessionMetadata(
  result: SubmitPromptResult,
  deps: CommandCenterDeps,
  app?: CommandCenterApp,
): SubmitPromptResult {
  return {
    ...result,
    locale: result.locale ?? app?.getLocale?.(),
    mode: result.mode ?? deps.getMode?.(),
    model: result.model ?? app?.getModel?.(),
    theme: result.theme ?? app?.getTheme?.(),
    thoughtLevel: result.thoughtLevel ?? app?.getThoughtLevel?.(),
  };
}
