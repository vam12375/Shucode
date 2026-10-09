import type { ShucodeSessionStateSnapshot } from "@shucode/shared";
import type {
  ShucodeSessionWorkspaceTarget,
  ShucodeTaskTarget,
} from "#src/shucode-session/shucodeSession.js";

function getWorkspaceKey(target: ShucodeSessionWorkspaceTarget): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}

function getSessionScopedKey(target: ShucodeTaskTarget): string {
  return `${getWorkspaceKey(target)}\0${target.sessionId}`;
}

export function createShucodeDeferredDraftRegistry() {
  const sessionKeys = new Set<string>();

  return {
    remember(params: ShucodeSessionWorkspaceTarget, snapshot: ShucodeSessionStateSnapshot): void {
      sessionKeys.add(
        getSessionScopedKey({
          workspacePath: snapshot.session.workspace.workspacePath,
          workspaceIdentity:
            snapshot.session.workspace.workspaceIdentity ?? params.workspaceIdentity,
          sessionId: snapshot.session.sessionId,
        }),
      );
    },

    has(target: ShucodeTaskTarget): boolean {
      return sessionKeys.has(getSessionScopedKey(target));
    },

    forget(target: ShucodeTaskTarget): void {
      sessionKeys.delete(getSessionScopedKey(target));
    },
  };
}
