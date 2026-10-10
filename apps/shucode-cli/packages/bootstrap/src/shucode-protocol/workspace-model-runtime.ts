/* eslint-disable max-lines -- workspace 模型协议与兼容请求处理仍集中在本文件。 */
import { createInMemorySessionEventStore } from "@shucode/adapters/storage";
import type { ModelSelection } from "@shucode/contracts";
import {
  shucodeProviderListModelsParamsSchema,
  shucodeProviderTestModelConnectivityParamsSchema,
  shucodeWorkspaceReadPresentationParamsSchema,
  type ShucodeWorkspaceRef,
} from "@shucode/shared";
import type { ShucodeApp, ShucodeAppOptions } from "../app/types.js";
import { listProtocolSlashCommands } from "./slash-commands.js";
import {
  parseParams,
  type ShucodeProtocolAgentServerContext,
  type ShucodeProtocolSessionRecord,
} from "./server-types.js";
import { runSessionModelConfigMutation } from "../shucode-protocol-v4/model-config-mutation.js";
import { createProviderRuntimeHeadersPort } from "./provider-runtime-headers.js";
import { listProviderModels } from "./provider-model-listing.js";

export async function readWorkspacePresentation(
  context: ShucodeProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(shucodeWorkspaceReadPresentationParamsSchema, rawParams);
  return {
    workspace: params.workspace,
    mode: "build" as const,
    slashCommands: await listProtocolSlashCommands({
      // 灰度门是 Host 判定的 workspace 级事实，目录装配读进程缓存。
      dynamicWorkflowEnabled: context.appRuntimePreferences.dynamicWorkflowEnabled,
      env: context.deps.env,
      logger: context.logger,
      workingDirectory: params.workspace.workspacePath,
    }),
  };
}

export async function testProviderModelConnectivity(
  context: ShucodeProtocolAgentServerContext,
  rawParams: unknown,
  abortSignal?: AbortSignal,
) {
  const params = parseParams(shucodeProviderTestModelConnectivityParamsSchema, rawParams);
  // 旧 Personal Config 跨进程 watcher 可能永久漏掉原子写事件；连接测试若不先
  // 主动刷新，会反复查询旧 Registry。这里复用正式 Registry refresh，不旁路创建配置事实。
  await context.deps.refreshProviderRegistry?.("provider-connectivity");
  const active = Array.from(context.sessions.values()).find(
    (record) => record.workspace.workspaceKey === params.workspace.workspaceKey,
  );
  const app =
    active?.app ??
    (await createWorkspaceShucodeApp(context, params.workspace, {
      env: context.deps.env,
      eventStore: createInMemorySessionEventStore(),
      runtimeConfig: { workingDirectory: params.workspace.workspacePath },
      sessionStore: context.deps.sessionStore,
      version: context.deps.version,
    }));
  try {
    await app.testModelConnectivity(
      { selection: params.selection as ModelSelection },
      { abortSignal },
    );
    return { success: true as const };
  } finally {
    if (!active) await app.close?.();
  }
}

/**
 * 「获取模型列表」：按设置页当前（可能尚未保存的）连接信息，从供应商拉取模型 ID。
 *
 * 这里刻意不建 ShucodeApp、不读 Provider Registry：候选端点与鉴权头只依赖请求参数，
 * 少了「表单草稿未落盘就拉不到列表」的时序耦合。请求只读，不写任何配置事实。
 */
export async function listProviderModelIds(
  context: ShucodeProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(shucodeProviderListModelsParamsSchema, rawParams);
  const result = await listProviderModels(params.connection);
  context.logger?.info("Shucode Protocol provider/listModels completed", {
    providerId: params.providerId,
    // 只记录命中的端点与数量，不记录 API Key 或自定义头。
    endpoint: result.endpoint,
    modelCount: result.models.length,
  });
  return {
    success: true as const,
    endpoint: result.endpoint,
    models: [...result.models],
  };
}

export async function createWorkspaceShucodeApp(
  context: ShucodeProtocolAgentServerContext,
  workspace: ShucodeWorkspaceRef,
  options: Omit<ShucodeAppOptions, "providerRegistry">,
): Promise<ShucodeApp> {
  const providerRuntimeHeadersPort =
    options.providerRuntimeHeadersPort ?? createProviderRuntimeHeadersPort(context, workspace);
  return context.deps.createShucodeApp({
    ...options,
    platform: context.deps.platform,
    providerRuntimeHeadersPort,
    runtimeConfig: {
      ...options.runtimeConfig,
      // createShucodeApp 会把 workingDirectory 规范化为执行 cwd。把协议入口的
      // workspacePath 单独注入 runtime，session 持久化才能保留本地 workspaceKey 的路径表示。
      workspacePath: workspace.workspacePath,
      // 远端 session 是 shared-host CUA 的第二层隔离边界：不能只传 workspacePath/identity，
      // 否则同一远端 workspace 的不同 attachment 会复用 Accessibility frame/action 状态。
      // 放在这个 helper 里而不是各调用点，是为了两条 session 创建路径都拿到同一份隔离键。
      ...(workspace.remoteSessionId ? { remoteSessionId: workspace.remoteSessionId } : {}),
      ...(workspace.workspaceIdentity
        ? {
            memory: {
              ...options.runtimeConfig?.memory,
              workspaceIdentity: workspace.workspaceIdentity,
            },
          }
        : {}),
      // Electron/Protocol 主会话之前没有像 CLI/TUI 那样显式开启模型流式，
      // 导致主 turn 退回 generateText 非流式请求，遇到返回 SSE 的兼容端点会按 JSON 解析失败。
      modelStreaming: options.runtimeConfig?.modelStreaming ?? "on",
    },
  });
}

export function hasSessionModelProvider(
  _context: ShucodeProtocolAgentServerContext,
  record: Pick<ShucodeProtocolSessionRecord, "app" | "workspace">,
  providerId: string,
): boolean {
  return record.app.listModels().some((model) => model.ref.providerId === providerId);
}

async function ensureSessionModelAvailableUnlocked(
  context: ShucodeProtocolAgentServerContext,
  record: ShucodeProtocolSessionRecord,
): Promise<boolean> {
  // 存量模型失效时不能静默改成 Registry 第一项覆盖用户选择；失效选择保持未绑定，
  // 由恢复/Composer 的选择校验和首发门禁处理；这里不能再写入另一份默认模型事实。
  // 保留该过渡入口是为了让旧协议调用方平稳退场。
  void context;
  void record;
  return false;
}

export async function ensureSessionModelAvailable(
  context: ShucodeProtocolAgentServerContext,
  record: ShucodeProtocolSessionRecord,
): Promise<boolean> {
  return runSessionModelConfigMutation(record.app, () =>
    ensureSessionModelAvailableUnlocked(context, record),
  );
}

export function resolveSessionModelContextWindow(
  _context: ShucodeProtocolAgentServerContext,
  record: Pick<ShucodeProtocolSessionRecord, "app" | "workspace" | "restoredModelSelection">,
): number | undefined {
  // 缺档位会让恢复选择暂不绑定 Runtime，但模型身份仍可只读查询容量，不能伪造 20 万。
  const selection = record.app.runtime.getSessionModelSelection() ?? record.restoredModelSelection;
  const value = selection && record.app.getModelOption?.(selection)?.contextWindow;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
