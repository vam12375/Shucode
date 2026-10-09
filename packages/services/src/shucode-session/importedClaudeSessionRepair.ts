import type { ShucodeSessionStateSnapshot } from "@shucode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { repairImportedClaudeSessionSnapshot } from "#src/session/claude-native/importedClaudeHistoryRepair.js";
import type { IShucodeAgentService } from "#src/shucode-agent/shucodeAgent.js";
import type {
  ShucodeSessionReadParams,
  ShucodeSessionResumeParams,
} from "#src/shucode-session/shucodeSession.js";

const logger = createServiceLogger("shucode-session-service");

export async function repairEmptyImportedClaudeSessionSnapshot(params: {
  agentService: IShucodeAgentService;
  snapshot: ShucodeSessionStateSnapshot;
  target: ShucodeSessionResumeParams | ShucodeSessionReadParams;
}): Promise<ShucodeSessionStateSnapshot> {
  const repaired = await repairImportedClaudeSessionSnapshot({
    snapshot: params.snapshot,
    target: {
      workspacePath: params.target.workspacePath,
      workspaceIdentity: params.target.workspaceIdentity,
      taskId: params.target.sessionId,
      ...("mcpServers" in params.target && params.target.mcpServers
        ? { mcpServers: params.target.mcpServers }
        : {}),
    },
    createSession: (input) => params.agentService.createSession(input),
    onRepair: (history) => {
      logger.warn(
        undefined,
        `[shucode-session-service] Claude 导入 session 历史异常，按 ${history.source} 回填 taskId=${params.target.sessionId}`,
      );
    },
  });
  return repaired ?? params.snapshot;
}
