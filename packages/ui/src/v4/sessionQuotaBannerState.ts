import { BUILTIN_MODEL_PROVIDER_IDS, isStartPlanModelProviderId } from "@shucode/shared";
import type {
  GlmQuotaBannerBusinessCode,
  StartPlanConcurrentLimitBannerReason,
} from "@/lib/providerBusinessError.js";
import type { McpUnavailableNotice } from "@/v4/mcpUnavailableBannerNotice.js";

/**
 * 二开定制：原实现还依赖 `UsageEntitlementSnapshot` 构造 Start Plan 低额度/耗尽提醒
 * （`startPlanQuotaBuckets`）。套餐额度链路已删除，横幅只保留**服务端业务错误**与
 * **官方 Server MCP 不可用**两类事实，不再读取任何权益或额度快照。
 */
export type SessionQuotaBannerKind =
  | "daily-exhausted"
  | "concurrent-limit"
  | "provider-limited"
  | "mcp-quota-exhausted"
  | "mcp-plan-required";

export interface SessionQuotaBannerState {
  visible: boolean;
  kind: SessionQuotaBannerKind | null;
  concurrentLimitBusinessCode: "3008" | "3009" | "3010" | null;
  concurrentLimitReason: StartPlanConcurrentLimitBannerReason | null;
  providerLimitedBusinessCode: GlmQuotaBannerBusinessCode | null;
  providerLimitedMessage: string | null;
  modelName: string | null;
  /** 官方 Server MCP 提示专用：出问题的 MCP server 名，用于文案点名。 */
  mcpServerName: string | null;
  /** 官方 Server MCP 提示专用：产生该事实的 tool row，参与去重键。 */
  mcpNoticeRowId: number | null;
  dismissible: boolean;
  blocksSubmit: boolean;
  priority: number;
}

const HIDDEN_SESSION_QUOTA_BANNER_STATE: SessionQuotaBannerState = {
  visible: false,
  kind: null,
  concurrentLimitBusinessCode: null,
  concurrentLimitReason: null,
  providerLimitedBusinessCode: null,
  providerLimitedMessage: null,
  modelName: null,
  mcpServerName: null,
  mcpNoticeRowId: null,
  dismissible: false,
  blocksSubmit: false,
  priority: 0,
};

function isGlmQuotaBannerProviderId(providerId: string): boolean {
  return (
    providerId === BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan ||
    providerId === BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan ||
    providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan ||
    providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan
  );
}

function normalizeProviderLimitedBannerMessage(message: string | null | undefined): string | null {
  const normalizedMessage = message?.trim();
  if (!normalizedMessage) return null;
  const bracketParts = [...normalizedMessage.matchAll(/\[([^\]]*)\]/gu)].map(
    (match) => match[1]?.trim() ?? "",
  );
  return bracketParts.length >= 3 && bracketParts[1] ? bracketParts[1] : normalizedMessage;
}

/** 额度业务错误按服务端返回的 code 决定横幅，不再读取本地权益快照。 */
export function buildSessionQuotaBannerState(params: {
  activeProviderId: string | null;
  modelId: string | null;
  serverQuotaExhausted?: boolean;
  serverConcurrentLimited?: boolean;
  serverConcurrentLimitBusinessCode?: "3008" | "3009" | "3010";
  serverConcurrentLimitReason?: StartPlanConcurrentLimitBannerReason;
  serverProviderLimitedBusinessCode?: GlmQuotaBannerBusinessCode;
  serverProviderLimitedMessage?: string | null;
  /** 官方 Server MCP 在本次会话内被判定不可用的事实（来自 tool row 的结构化标识）。 */
  mcpUnavailableNotice?: McpUnavailableNotice | null;
}): SessionQuotaBannerState {
  if (
    params.serverConcurrentLimited === true &&
    params.activeProviderId &&
    isStartPlanModelProviderId(params.activeProviderId)
  ) {
    return {
      visible: true,
      kind: "concurrent-limit",
      concurrentLimitBusinessCode: params.serverConcurrentLimitBusinessCode ?? null,
      concurrentLimitReason: params.serverConcurrentLimitReason ?? "initial-busy",
      providerLimitedBusinessCode: null,
      providerLimitedMessage: null,
      modelName: params.modelId,
      mcpServerName: null,
      mcpNoticeRowId: null,
      dismissible: true,
      blocksSubmit: false,
      priority: 60,
    };
  }

  if (
    params.serverQuotaExhausted === true &&
    params.activeProviderId &&
    isStartPlanModelProviderId(params.activeProviderId)
  ) {
    return {
      visible: true,
      kind: "daily-exhausted",
      concurrentLimitBusinessCode: null,
      concurrentLimitReason: null,
      providerLimitedBusinessCode: null,
      providerLimitedMessage: null,
      modelName: null,
      mcpServerName: null,
      mcpNoticeRowId: null,
      dismissible: false,
      blocksSubmit: false,
      priority: 50,
    };
  }

  if (
    params.serverProviderLimitedBusinessCode &&
    params.activeProviderId &&
    isGlmQuotaBannerProviderId(params.activeProviderId)
  ) {
    return {
      visible: true,
      kind: "provider-limited",
      concurrentLimitBusinessCode: null,
      concurrentLimitReason: null,
      providerLimitedBusinessCode: params.serverProviderLimitedBusinessCode,
      providerLimitedMessage: normalizeProviderLimitedBannerMessage(
        params.serverProviderLimitedMessage,
      ),
      modelName: params.modelId,
      mcpServerName: null,
      mcpNoticeRowId: null,
      dismissible: true,
      blocksSubmit: false,
      priority: 45,
    };
  }

  // 官方 Server MCP 不可用（额度耗尽 / 无 Coding Plan）。
  //
  // 位置要求：必须在上面几条服务端业务错误之后——模型侧问题更紧急，不能被 MCP 提示挡住。
  if (params.mcpUnavailableNotice) {
    const mcpQuotaExhausted = params.mcpUnavailableNotice.code === "quota_exceeded";
    return {
      visible: true,
      kind: mcpQuotaExhausted ? "mcp-quota-exhausted" : "mcp-plan-required",
      concurrentLimitBusinessCode: null,
      concurrentLimitReason: null,
      providerLimitedBusinessCode: null,
      providerLimitedMessage: null,
      modelName: null,
      mcpServerName: params.mcpUnavailableNotice.serverName,
      mcpNoticeRowId: params.mcpUnavailableNotice.rowId,
      dismissible: true,
      // MCP 不可用不影响模型对话，绝不阻断输入。
      blocksSubmit: false,
      priority: mcpQuotaExhausted ? 6 : 8,
    };
  }

  return HIDDEN_SESSION_QUOTA_BANNER_STATE;
}

export function buildSessionQuotaBannerDismissKey(
  state: SessionQuotaBannerState,
  serverErrorKey?: string | null,
): string | null {
  if (!state.visible || !state.kind) return null;
  return [
    state.kind,
    state.concurrentLimitBusinessCode ?? "",
    state.concurrentLimitReason ?? "",
    state.providerLimitedBusinessCode ?? "",
    state.providerLimitedMessage ?? "",
    state.modelName ?? "",
    // MCP 提示按 server + 具体调用去重：关闭一次后同一次调用不再弹，
    // 之后再有新的失败调用（新 rowId）会重新弹。
    state.mcpServerName ?? "",
    state.mcpNoticeRowId ?? "",
    state.blocksSubmit ? "blocked" : "unblocked",
    serverErrorKey ?? "",
  ].join(":");
}
