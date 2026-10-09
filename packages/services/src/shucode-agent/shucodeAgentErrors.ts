// 原始 -32602 文案来自旧 Agent schema，跨 RPC 后 UI 不能靠易变字符串识别能力缺失。
// ChannelClient 会保留 error.code，因此用稳定 code 驱动设置页停止 status-only 轮询。
export const SHUCODE_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE =
  "SHUCODE_AGENT_MCP_STATUS_MODE_UNSUPPORTED";

export class ShucodeAgentMcpStatusModeUnsupportedError extends Error {
  readonly code = SHUCODE_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE;

  constructor() {
    super("The connected Shucode Agent does not support MCP status-only refresh");
    this.name = "ShucodeAgentMcpStatusModeUnsupportedError";
  }
}

export function isShucodeAgentMcpStatusModeUnsupportedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (
    (error as { code?: unknown }).code === SHUCODE_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE
  );
}
