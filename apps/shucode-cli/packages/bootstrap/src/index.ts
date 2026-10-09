// Bootstrap public API surface.

export * from "./app/create-app.js";
export type {
  ListShucodeSessionsOptions,
  PromptInput,
  ResolveLatestSessionOptions,
  ResumeOptions,
  RunShucodeProtocolAgentOptions,
  SendInputOptions,
  SendInputResult,
  SetLocaleResult,
  SteerTurnOptions,
  SubmitPromptOptions,
  UserPromptInput,
  ShucodeApp,
  ShucodeAppOptions,
  ShucodeModelOption,
} from "./app/types.js";
export * from "./auth-login.js";
export {
  inspectShucodeCustomCommand,
  listShucodeCustomCommands,
  loadShucodeCustomCommand,
} from "./custom-commands.js";
export type {
  InspectShucodeCustomCommandOptions,
  ListShucodeCustomCommandsOptions,
  ShucodeCustomCommandInspection,
} from "./custom-commands.js";
export { createModelAdapter } from "./model-factory.js";
export type { CreateModelAdapterOptions } from "./model-factory.js";
export { startProcessProviderRegistryRuntime } from "./app/process-provider-registry-runtime.js";
export type { ProcessProviderRegistryRuntimeOptions } from "./app/process-provider-registry-runtime.js";
export {
  addShucodePluginMarketplace,
  getShucodePluginsOverview,
  installShucodeMarketplacePlugin,
  listShucodePlugins,
  removeShucodePluginMarketplace,
  resolveShucodePlugins,
  setShucodePluginEnabled,
  uninstallShucodeMarketplacePlugin,
  updateShucodeMarketplacePlugin,
  updateShucodePluginMarketplace,
  validateShucodePluginPath,
} from "./plugins.js";
export type {
  AddShucodeMarketplaceOptions,
  InstallShucodeMarketplacePluginOptions,
  ListShucodePluginsOptions,
  RemoveShucodeMarketplaceOptions,
  ResolveShucodePluginsOptions,
  SetShucodePluginEnabledOptions,
  SetShucodePluginEnabledResult,
  UninstallShucodeMarketplacePluginOptions,
  UpdateShucodeMarketplaceOptions,
  UpdateShucodeMarketplacePluginOptions,
  ValidateShucodePluginPathOptions,
  ShucodeAvailablePluginData,
  ShucodeInstalledPluginData,
  ShucodeMarketplaceSummaryData,
  ShucodeMarketplaceUpdateData,
  ShucodePluginInstallData,
  ShucodePluginUpdateData,
  ShucodePluginsOverviewData,
} from "./plugins.js";
export { runShucodeProtocolAgent } from "./shucode-protocol-entrypoint.js";
// Exposed for the CLI's --output-format stream-json: it needs the same event
// shape the protocol server emits, rather than inventing a second one.
export { mapSessionEvent } from "./shucode-protocol/session-mapper.js";
export { prepareShucodeTelemetryEnv, shutdownShucodeTelemetry } from "./telemetry-bootstrap.js";
export type { SessionTranscriptMessage, SessionTranscriptPart } from "./session-transcript.js";
export { listShucodeSessions, resolveLatestSession } from "./sessions.js";
export { inspectShucodeSkill, listShucodeSkills } from "./skills.js";
export type {
  InspectShucodeSkillOptions,
  ListShucodeSkillsOptions,
  ShucodeSkillInspection,
} from "./skills.js";
// Exposed for the CLI's headless slash routing: it must decide "is this a real
// custom command?" with the *same* reserved-name gate the app facade's
// customCommandPromptResolver applies, or the two disagree and a reserved name
// reaches the model as literal prompt text. See prompt-command.ts.
export { isReservedShucodeSlashCommandName } from "./slash-command-surface.js";
export {
  grantWorkspaceHookTrust,
  inspectWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
} from "./workspace-hook-trust-cli.js";
export type {
  WorkspaceHookTrustCliItem,
  WorkspaceHookTrustCliStatus,
  WorkspaceHookTrustCliTarget,
} from "./workspace-hook-trust-cli.js";
