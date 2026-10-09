import type {
  ShucodeAgentMcpServer,
  ShucodeAutomationScheduleRule,
  ShucodeMcpListMode,
  ModelSelection,
} from "@shucode/shared";

export interface ShucodeAgentWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 远程 workspace 的运行时会话身份；只用于隔离/路由，不能替代 workspacePath。 */
  remoteSessionId?: string;
}

export interface ShucodeAgentPluginViewParams extends ShucodeAgentWorkspaceTarget {
  configScope?: "user" | "workspace";
}

export interface ShucodeAgentListMcpServerStatusesParams extends ShucodeAgentWorkspaceTarget {
  mcpServers?: ShucodeAgentMcpServer[];
  mode?: ShucodeMcpListMode;
}

export interface ShucodeAgentAddPluginMarketplaceParams extends ShucodeAgentWorkspaceTarget {
  dryRun?: boolean;
  operationId?: string;
  source: string;
}

export interface ShucodeAgentRemovePluginMarketplaceParams extends ShucodeAgentWorkspaceTarget {
  marketplace: string;
}

export interface ShucodeAgentUpdatePluginMarketplaceParams extends ShucodeAgentWorkspaceTarget {
  marketplace?: string;
  operationId?: string;
}

export interface ShucodeAgentInstallPluginParams extends ShucodeAgentWorkspaceTarget {
  dryRun?: boolean;
  marketplace: string;
  operationId?: string;
  pluginName: string;
  scope?: "user" | "workspace";
}

export interface ShucodeAgentCancelPluginOperationParams {
  operationId: string;
}

export interface ShucodeAgentUninstallPluginParams extends ShucodeAgentWorkspaceTarget {
  marketplace?: string;
  pluginId?: string;
  pluginName?: string;
  removeCache?: boolean;
}

export interface ShucodeAgentUpdatePluginParams extends ShucodeAgentWorkspaceTarget {
  pluginId?: string;
  marketplace?: string;
}

export interface ShucodeAgentRestoreBuiltinPluginParams extends ShucodeAgentWorkspaceTarget {
  pluginId: string;
}

export interface ShucodeAgentConfigurePluginParams extends ShucodeAgentWorkspaceTarget {
  clearOptionKeys?: string[];
  dryRun?: boolean;
  options: Record<string, unknown>;
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface ShucodeAgentResetPluginConfigParams extends ShucodeAgentWorkspaceTarget {
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface ShucodeAgentValidatePluginParams extends ShucodeAgentWorkspaceTarget {
  marketplace?: string;
  pluginName?: string;
  source?: string;
}

export interface ShucodeAgentDescribePluginParams extends ShucodeAgentWorkspaceTarget {
  marketplace: string;
  pluginName: string;
}

export interface ShucodeAgentSetPluginEnabledParams extends ShucodeAgentWorkspaceTarget {
  enabled: boolean;
  operationId?: string;
  pluginId: string;
  scope?: "user" | "workspace";
}

// Plugin 对话引用 catalog：
// 带 sessionId → session-owned 冻结 catalog（必须路由到持有该 session 的 workspace client）；
// 不带 → workspace 当前 catalog（新建草稿 Picker）。
export interface ShucodeAgentPluginReferenceCatalogParams extends ShucodeAgentWorkspaceTarget {
  sessionId?: string;
}

// Composer Skill catalog：与 Plugin 引用相同，以 sessionId 区分 workspace 当前目录和
// resident Session runtime 快照；不参与 Settings 管理目录。
export interface ShucodeAgentSkillReferenceCatalogParams extends ShucodeAgentWorkspaceTarget {
  sessionId?: string;
}
export interface ShucodeAgentResolveSuggestedPluginReferenceParams extends ShucodeAgentWorkspaceTarget {
  stableId: string;
  operationId: string;
  clientMode: "desktop-continuous" | "web-remote-replayable";
  deliveryKind: "desktop-continuous" | "web-remote-replayable";
}

// ---- 定时任务(automation)管理参数 ----

export interface ShucodeAgentCreateAutomationParams extends ShucodeAgentWorkspaceTarget {
  title: string;
  cronExpr: string;
  relativeDelayMinutes?: number;
  prompt: string;
  modelSelection?: ModelSelection;
  mode?: string;
  recurring?: boolean;
  maxRuns?: number;
  endAt?: number;
  scheduleRule?: ShucodeAutomationScheduleRule;
}

export interface ShucodeAgentUpdateAutomationParams extends ShucodeAgentWorkspaceTarget {
  automationId: string;
  title?: string;
  cronExpr?: string;
  prompt?: string;
  modelSelection?: ModelSelection | null;
  mode?: string | null;
  recurring?: boolean;
  maxRuns?: number | null;
  endAt?: number | null;
  scheduleRule?: ShucodeAutomationScheduleRule | null;
  scheduleEditedByUser?: boolean;
}

export interface ShucodeAgentAutomationIdParams extends ShucodeAgentWorkspaceTarget {
  automationId: string;
}

export interface ShucodeAgentSetAutomationEnabledParams extends ShucodeAgentWorkspaceTarget {
  automationId: string;
  enabled: boolean;
}

export interface ShucodeAgentDeleteAutomationRunParams extends ShucodeAgentWorkspaceTarget {
  runId: string;
}
