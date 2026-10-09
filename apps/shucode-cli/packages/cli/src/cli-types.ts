import type { TuiReadClipboardImage, TuiWriteClipboardText } from "@shucode/tui";
import type { UiLocale } from "@shucode/i18n";
import type { Logger } from "@shucode/contracts";
import type {
  createManagedCdpBrowserRuntime,
  ManagedCdpBrowserRuntimeOptions,
} from "@shucode/adapters/browser";
import type {
  createModelAdapter,
  createShucodeApp,
  CreateModelAdapterOptions,
  configureCodingPlanApiKey,
  ConfigureCodingPlanApiKeyOptions,
  inspectShucodeSkill,
  inspectWorkspaceHookTrust,
  grantWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
  inspectShucodeCustomCommand,
  InspectShucodeCustomCommandOptions,
  InspectShucodeSkillOptions,
  loginShucodeCli,
  loginBigmodelCodingPlan,
  LoginBigmodelCodingPlanOptions,
  LoginShucodeCliOptions,
  listShucodeCustomCommands,
  ListShucodeCustomCommandsOptions,
  loadShucodeCustomCommand,
  listShucodeSessions,
  listShucodeSkills,
  ListShucodeSessionsOptions,
  ListShucodeSkillsOptions,
  logoutShucodeCli,
  LogoutShucodeCliOptions,
  resolveLatestSession,
  ResolveLatestSessionOptions,
  RunShucodeProtocolAgentOptions,
  prepareShucodeTelemetryEnv,
  startProcessProviderRegistryRuntime,
  shutdownShucodeTelemetry,
  ShucodeAppOptions,
} from "@shucode/bootstrap";
import type { CliEnv, DotenvLoadResult, LoadCliDotenvOptions } from "./env.js";
import type { PluginsCommandOverrides } from "./plugins-command.js";
import type { CliShutdownProcess } from "./shutdown.js";
import type { resolveWorkspaceGitBranch } from "./tui-workspace-git.js";

export type BootstrapModule = typeof import("@shucode/bootstrap");

export interface RunDependencies extends PluginsCommandOverrides {
  protocolLifecycle?: RunShucodeProtocolAgentOptions["lifecycle"];
  protocolInput?: NodeJS.ReadableStream;
  createManagedCdpBrowserRuntime?: (
    options?: ManagedCdpBrowserRuntimeOptions,
  ) => ReturnType<typeof createManagedCdpBrowserRuntime>;
  createModelAdapter?: (
    options?: CreateModelAdapterOptions,
  ) => ReturnType<typeof createModelAdapter>;
  createShucodeApp?: (
    options?: ShucodeAppOptions,
  ) => Awaited<ReturnType<typeof createShucodeApp>> | ReturnType<typeof createShucodeApp>;
  /**
   * Session-event shaper for --output-format stream-json. Defaults to the
   * bootstrap module's, which is also what the protocol server uses; injectable
   * so a caller that supplies its own `createShucodeApp` (tests, embedders) can
   * still stream, since the bootstrap module is not loaded on that path.
   */
  mapSessionEvent?: BootstrapModule["mapSessionEvent"];
  cwd?: () => string;
  env?: CliEnv;
  inspectSkill?: (options: InspectShucodeSkillOptions) => ReturnType<typeof inspectShucodeSkill>;
  inspectWorkspaceHookTrust?: typeof inspectWorkspaceHookTrust;
  grantWorkspaceHookTrust?: typeof grantWorkspaceHookTrust;
  revokeWorkspaceHookTrustCli?: typeof revokeWorkspaceHookTrustCli;
  inspectCustomCommand?: (
    options: InspectShucodeCustomCommandOptions,
  ) => ReturnType<typeof inspectShucodeCustomCommand>;
  loginShucodeCli?: (options?: LoginShucodeCliOptions) => ReturnType<typeof loginShucodeCli>;
  loginBigmodelCodingPlan?: (
    options?: LoginBigmodelCodingPlanOptions,
  ) => ReturnType<typeof loginBigmodelCodingPlan>;
  configureCodingPlanApiKey?: (
    options: ConfigureCodingPlanApiKeyOptions,
  ) => ReturnType<typeof configureCodingPlanApiKey>;
  loadDotenv?: (options?: LoadCliDotenvOptions) => DotenvLoadResult;
  prepareShucodeTelemetryEnv?: typeof prepareShucodeTelemetryEnv;
  projectConfigPath?: string;
  listSessions?: (options: ListShucodeSessionsOptions) => ReturnType<typeof listShucodeSessions>;
  listCustomCommands?: (
    options: ListShucodeCustomCommandsOptions,
  ) => ReturnType<typeof listShucodeCustomCommands>;
  loadCustomCommand?: (
    options: InspectShucodeCustomCommandOptions,
  ) => ReturnType<typeof loadShucodeCustomCommand>;
  // headless slash 路由要和 app facade 的保留名 gate 用同一个判据；默认取 bootstrap 的，
  // 注入点只为让单测不必拉起整个 bootstrap 模块。见 prompt-command.ts。
  isReservedSlashCommandName?: BootstrapModule["isReservedShucodeSlashCommandName"];
  listSkills?: (options: ListShucodeSkillsOptions) => ReturnType<typeof listShucodeSkills>;
  logger?: Logger;
  readClipboardImage?: TuiReadClipboardImage;
  writeClipboardText?: TuiWriteClipboardText;
  resolveLatestSession?: (
    options: ResolveLatestSessionOptions,
  ) => ReturnType<typeof resolveLatestSession>;
  resolveWorkspaceGitBranch?: typeof resolveWorkspaceGitBranch;
  logoutShucodeCli?: (options?: LogoutShucodeCliOptions) => ReturnType<typeof logoutShucodeCli>;
  runShucodeProtocolAgent?: (options?: RunShucodeProtocolAgentOptions) => Promise<void>;
  runTui?: typeof import("@shucode/tui").runTui;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  exitProcess?: (code: number) => void;
  shutdownCleanupTimeoutMs?: number;
  shutdownProcess?: CliShutdownProcess;
  startProcessProviderRegistryRuntime?: typeof startProcessProviderRegistryRuntime;
  shutdownShucodeTelemetry?: typeof shutdownShucodeTelemetry;
}

export type CliPermissionMode = "build" | "plan" | "edit" | "yolo";
export type CliRuntimeMode = CliPermissionMode | "auto";

export interface CliModeState {
  current?: CliRuntimeMode;
  override?: CliPermissionMode;
}

export interface CliTargetRequest {
  objective: string;
  replaceExisting: boolean;
}

export type ModeCapableApp = Awaited<ReturnType<typeof createShucodeApp>> & {
  getMode?: () => CliRuntimeMode;
  setLocale?: (locale: UiLocale) => Promise<{ locale: "en-US" | "zh-CN" }>;
  setMode?: (mode: CliRuntimeMode) => Promise<{ mode: CliRuntimeMode }>;
};

export interface CliResumeRequest {
  continueSession: boolean;
  resumeSessionId?: string;
}
