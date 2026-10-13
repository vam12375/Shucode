import type { SubmitPromptResult } from "../interaction-types.js";
import { buildCustomCommandPrompt } from "../../command-center-custom.js";
import { attachCurrentSessionMetadata } from "../metadata.js";
import type { CommandCenterDeps, SubmitOptions } from "../types.js";

export async function handleCustomCommand(
  name: string,
  args: string,
  deps: CommandCenterDeps,
  options: SubmitOptions,
): Promise<SubmitPromptResult | undefined> {
  const prompt = await buildCustomCommandPrompt(name, args, deps);
  if (!prompt) return undefined;
  const app = await deps.getApp();
  const result = await app.submitPrompt(prompt, options);
  return attachCurrentSessionMetadata(result, deps, app);
}
