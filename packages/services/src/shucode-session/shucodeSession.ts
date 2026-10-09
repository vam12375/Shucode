import { ServiceChannels } from "@shucode/shared";
import type {
  TraceId,
  ShucodeAgentMcpServer,
  ShucodeDeliveryKind,
  ShucodeMessageWithParts,
  ModelSelection,
  ShucodePermissionRequestParams,
  ShucodeUserInputRequestParams,
  ShucodeUserInputResponse,
  ShucodeSessionInfo,
  ShucodeSessionImportHistory,
  ShucodeSessionEvent,
  ShucodeSessionMode,
  ShucodeSessionPersistence,
  ShucodeSessionStateSnapshot,
  ShucodeStateUpdatedNotification,
  ShucodeWorkspacePresentation,
} from "@shucode/shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export interface ShucodeSessionWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export type ShucodeSessionReadWorkspacePresentationParams = ShucodeSessionWorkspaceTarget;

export interface ShucodeTaskTarget extends ShucodeSessionWorkspaceTarget {
  sessionId: string;
}

export interface ShucodeSessionCreateParams extends ShucodeSessionWorkspaceTarget {
  /** 仅导入事务使用的预分配 ID；普通新会话继续由 Agent 分配。 */
  sessionId?: string;
  sessionTraceId?: TraceId;
  parentSessionId?: string;
  mode?: ShucodeSessionMode;
  model?: ModelSelection;
  persistence?: ShucodeSessionPersistence;
  thoughtLevel?: string;
  mcpServers?: ShucodeAgentMcpServer[];
  importedHistory?: ShucodeSessionImportHistory;
}

export interface ShucodeSessionResumeParams extends ShucodeTaskTarget {
  model?: ModelSelection;
  thoughtLevel?: string;
  mcpServers?: ShucodeAgentMcpServer[];
  /**
   * 默认广播 resume 得到的历史快照，并让 shadow 订阅请求初始 snapshot。
   * 续聊发送前的 runtime 预恢复会关闭它，避免旧终态快照覆盖本地已开始的新输入运行态。
   */
  broadcastSnapshot?: boolean;
}

export interface ShucodeSessionListParams extends ShucodeSessionWorkspaceTarget {
  includeArchived?: boolean;
  limit?: number;
}

export interface ShucodeSessionReadParams extends ShucodeTaskTarget {
  deliveryKind?: ShucodeDeliveryKind;
  messageLimit?: number;
  afterSeq?: number;
}

export interface ShucodeSessionMessagesParams extends ShucodeTaskTarget {
  afterMessageId?: string;
  limit?: number;
}

export interface ShucodeSessionEventsParams extends ShucodeTaskTarget {
  afterSeq?: number;
  limit?: number;
}

export interface ShucodeSessionSetModelParams extends ShucodeTaskTarget {
  model: ModelSelection;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface ShucodeSessionSetThoughtLevelParams extends ShucodeTaskTarget {
  thoughtLevel?: string;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface ShucodeSessionSetModeParams extends ShucodeTaskTarget {
  mode: ShucodeSessionMode;
  expectedRevision?: number;
}

export interface ShucodeSessionSubscribeParams extends ShucodeTaskTarget {
  deliveryKind: ShucodeDeliveryKind;
  afterSeq?: number;
  includeSnapshot?: boolean;
  eventCoalescing?: {
    mode: "background-summary";
    intervalMs?: number;
  };
}

export type ShucodeSessionServiceEvent =
  | { type: "session.event"; event: ShucodeSessionEvent }
  | { type: "state.updated"; notification: ShucodeStateUpdatedNotification }
  | { type: "permission.request"; request: ShucodePermissionRequestParams }
  | { type: "userInput.request"; request: ShucodeUserInputRequestParams }
  | {
      type: "userInput.response";
      requestId: string;
      response: ShucodeUserInputResponse;
    }
  | { type: "snapshot"; snapshot: ShucodeSessionStateSnapshot };

export interface ShucodeSessionInitializeResult {
  available: boolean;
  workspaceKey: string;
  protocolName?: string;
  protocolVersion?: number;
  transportKind?: "stdio" | "websocket";
  reason?: string;
  reasonCode?: "provider_not_ready";
}

export interface ShucodeSessionWorkspaceRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export interface IShucodeSessionService {
  initializeWorkspace(
    params: ShucodeSessionWorkspaceTarget,
  ): Promise<ShucodeSessionInitializeResult>;
  getWorkspaceRuntimeIdentity(
    params: ShucodeSessionWorkspaceTarget,
  ): Promise<ShucodeSessionWorkspaceRuntimeIdentity>;
  readWorkspacePresentation(
    params: ShucodeSessionReadWorkspacePresentationParams,
  ): Promise<ShucodeWorkspacePresentation>;
  createSession(params: ShucodeSessionCreateParams): Promise<ShucodeSessionStateSnapshot>;
  resumeSession(params: ShucodeSessionResumeParams): Promise<ShucodeSessionStateSnapshot>;
  listSessions(params: ShucodeSessionListParams): Promise<ShucodeSessionInfo[]>;
  readSession(params: ShucodeSessionReadParams): Promise<ShucodeSessionStateSnapshot>;
  readSessionMessages(params: ShucodeSessionMessagesParams): Promise<ShucodeMessageWithParts[]>;
  readSessionEvents(params: ShucodeSessionEventsParams): Promise<ShucodeSessionEvent[]>;
  promoteDeferredDraftSession(params: ShucodeTaskTarget): Promise<void>;
  closeSession(params: ShucodeTaskTarget): Promise<void>;
  closeDeferredDraftSession(params: ShucodeTaskTarget): Promise<boolean>;
  setModel(params: ShucodeSessionSetModelParams): Promise<ShucodeSessionStateSnapshot>;
  setThoughtLevel(
    params: ShucodeSessionSetThoughtLevelParams,
  ): Promise<ShucodeSessionStateSnapshot>;
  setMode(params: ShucodeSessionSetModeParams): Promise<ShucodeSessionStateSnapshot>;
  // renderer 订阅面走 agentService 的 conversation/sessions-index 帧通道。
}

export const IShucodeSessionService = createServiceDescriptor<IShucodeSessionService>(
  ServiceChannels.ShucodeSession,
);
