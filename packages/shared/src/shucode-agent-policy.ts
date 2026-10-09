import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { ShucodeProvider } from "./shucode-task-types-core.js";

export const SHUCODE_AGENT_PROVIDER = "glm" satisfies ShucodeProvider;
export const SHUCODE_AGENT_PROVIDER_LABEL = "Shucode Agent";
export const SHUCODE_COMMAND_AGENT_SOURCE = "shucodeAgent" satisfies CommandAgentSource;

export const shucodeAgentProviderSchema = z.literal(SHUCODE_AGENT_PROVIDER);

export const SHUCODE_COMMAND_AGENT_SOURCES = [
  SHUCODE_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToShucodeAgent(
  _provider?: ShucodeProvider | null,
): ShucodeProvider {
  return SHUCODE_AGENT_PROVIDER;
}

export function isShucodeAgentProvider(
  provider: ShucodeProvider | null | undefined,
): provider is typeof SHUCODE_AGENT_PROVIDER {
  return provider === SHUCODE_AGENT_PROVIDER;
}
