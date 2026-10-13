/**
 * 命令中心的交互合同（prompt 输入、提交结果、选择器、send input、子代理读取）。
 *
 * 这些类型原定义在已下线的 TUI 包中，终端形态移除时逐字迁移到本文件；`Tui` 前缀已在
 * 词汇收尾批次移除。见 specs/cli/terminal-surface-removal.md。
 */
import type {
  ModelSelection,
  ShucodeModelOption,
  ShucodeSessionSubagentsResult,
} from "@shucode/shared";
import type {
  CollaborationMode,
  InputDelivery,
  ModelUsageSummary,
  PermissionBrokerRequest,
  PermissionBrokerRequestOptions,
  PermissionBrokerResult,
  SessionEvent,
  SessionProjection,
  SupportedLocale,
  ToolResultDisplayPayload,
  TurnId,
  TurnSteerResult,
  UiThemePreference,
} from "@shucode/contracts";

export type ContextUsage = Pick<SessionProjection, "contextUsed" | "contextWindow">;

export type PromptAttachment = {
  type: "file" | "image" | "pdf" | "url";
  path?: string;
  content?: string;
};

export type PromptInput =
  | string
  | {
      text: string;
      attachments?: PromptAttachment[];
      /** Model picker commands retain the reference separately from their display text. */
      modelSelection?: ModelSelection;
    };

export type SelectionItem = {
  command: string;
  disabledReason?: string;
  id: string;
  input?: SelectionInput;
  keywords?: readonly string[];
  meta?: string;
  pending?: SelectionPending;
  primary: string;
  secondary?: string;
};

export type SelectionInput = {
  cancelStatus?: string;
  clearStatus?: string;
  emptyStatus?: string;
  help?: string;
  mask?: boolean;
  placeholder?: string;
  primary: string;
  secondary?: string;
  status?: string;
  submitStatus?: string;
};

export type SelectionPending = {
  cancelStatus?: string;
  help?: string;
  primary: string;
  secondary?: string;
  status?: string;
};

export type Selection = {
  emptyMessage: string;
  filterable?: boolean;
  help?: string;
  items: SelectionItem[];
  placement?: "action" | "composer";
  prompt: string;
  selectedIndex?: number;
  title: string;
};

export type RestoredTranscriptPart =
  | {
      text: string;
      type: "text";
    }
  | {
      text: string;
      type: "thought";
    }
  | {
      error?: string;
      input: Record<string, unknown>;
      output?: string;
      resultDisplay?: ToolResultDisplayPayload;
      status: "pending" | "running" | "completed" | "failed";
      title?: string;
      toolCallId: string;
      toolName: string;
      type: "tool";
    };

export type EffortOption = {
  description?: string;
  id: string;
  label: string;
};

export type ModelOption = ShucodeModelOption;

export type SubmitPromptResult = {
  effortOptions?: readonly EffortOption[];
  modelOptions?: readonly ModelOption[];
  locale?: SupportedLocale;
  loginRequired?: boolean;
  mode?: CollaborationMode;
  model?: string;
  theme?: UiThemePreference;
  projection?: Partial<ContextUsage>;
  response: string;
  resetSessionProjection?: boolean;
  restoredMessages?: Array<{
    id?: string;
    content: string;
    parts?: RestoredTranscriptPart[];
    role: "agent" | "system" | "user";
  }>;
  selection?: Selection;
  sessionId?: string;
  thoughtLevel?: string;
  traceId?: string;
  turnId?: string;
  usage?: ModelUsageSummary;
};

export type RequestPermission = (
  request: PermissionBrokerRequest,
  options?: PermissionBrokerRequestOptions,
) => Promise<PermissionBrokerResult>;

export type SubmitPrompt = (
  prompt: PromptInput,
  options: {
    abortSignal: AbortSignal;
    onEvent?: (event: SessionEvent) => void | Promise<void>;
    requestPermission?: RequestPermission;
  },
) => Promise<SubmitPromptResult>;

export type SendInputResult =
  | {
      kind: "started_turn";
      result: SubmitPromptResult;
    }
  | {
      kind: "command_result";
      result: SubmitPromptResult;
    }
  | TurnSteerResult;

export type SendInput = (
  input: PromptInput,
  options: {
    abortSignal?: AbortSignal;
    delivery?: InputDelivery;
    expectedTurnId?: TurnId;
    onEvent?: (event: SessionEvent) => void | Promise<void>;
    requestPermission?: RequestPermission;
  },
) => Promise<SendInputResult>;

export type ReadSubagents = (input?: {
  endedCursor?: string;
  endedLimit?: number;
}) => Promise<ShucodeSessionSubagentsResult>;

export type SubagentTranscriptSnapshot = {
  sessionId: string;
  sequenceNumber: number;
  messages: NonNullable<SubmitPromptResult["restoredMessages"]>;
  events: SessionEvent[];
  replayMessageIds: string[];
};

export type ReadSubagentTranscript = (
  childSessionId: string,
) => Promise<SubagentTranscriptSnapshot>;

export type SlashCommandSuggestion = {
  aliases?: readonly string[];
  name: string;
  summary: string;
  usage: string;
};
