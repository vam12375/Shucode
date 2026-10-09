/**
 * Shucode Agent Slash Commands 便捷 hook
 *
 * 返回当前 workspace 下 Agent 广播的可用 slash commands 列表。
 */
import {
  useShucodeSessionStore,
  selectWorkspaceShucodeState,
} from "../store/shucodeSessionStore.js";

export function useSlashCommands(workspacePath: string, workspaceIdentity?: string) {
  return useShucodeSessionStore(
    (state) => selectWorkspaceShucodeState(state, workspacePath, workspaceIdentity).slashCommands,
  );
}
