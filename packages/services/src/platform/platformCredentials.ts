/**
 * 平台账号凭据的单一读写路径。
 *
 * 凭据 key（加密凭据存储，`platform:` 命名空间）：
 * - `platform:session`：JSON 会话展示信息（含登录时 endpoint origin）
 * - `platform:device_token`：平台网关请求凭据（mdp_*）
 *
 * platformAuthService 与 platformUserConfigService 都经本模块读写，
 * 避免两处各自拼 key 或解析 JSON 造成口径漂移。
 */
import { isCredentialDecryptError, type PlatformSessionInfo } from "@shucode/shared";
import type { ICredentialService } from "../credential/credential.js";

export const PLATFORM_SESSION_CREDENTIAL_KEY = "platform:session";
export const PLATFORM_DEVICE_TOKEN_CREDENTIAL_KEY = "platform:device_token";

interface PlatformCredentialBundle {
  session: PlatformSessionInfo;
  deviceToken: string;
}

function parseSession(raw: string): PlatformSessionInfo | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const candidate = parsed as Partial<PlatformSessionInfo>;
  if (
    typeof candidate.userId !== "string" ||
    typeof candidate.email !== "string" ||
    typeof candidate.displayName !== "string" ||
    typeof candidate.origin !== "string" ||
    typeof candidate.deviceTokenHint !== "string" ||
    typeof candidate.loginAt !== "string" ||
    !Array.isArray(candidate.teams)
  ) {
    return null;
  }
  return {
    userId: candidate.userId,
    email: candidate.email,
    displayName: candidate.displayName,
    teams: candidate.teams.flatMap((team) => {
      if (!team || typeof team !== "object") return [];
      const entry = team as { id?: unknown; name?: unknown; role?: unknown };
      if (
        typeof entry.id !== "string" ||
        typeof entry.name !== "string" ||
        (entry.role !== "owner" && entry.role !== "member")
      ) {
        return [];
      }
      return [{ id: entry.id, name: entry.name, role: entry.role }];
    }),
    origin: candidate.origin,
    deviceTokenHint: candidate.deviceTokenHint,
    loginAt: candidate.loginAt,
  };
}

/**
 * 读取当前 endpoint 下的完整凭据。
 * origin 不匹配、字段损坏或解密失败都按未登录处理（返回 null，不抛错）；
 * 凭据损坏时的清理由调用方决定，不在读取路径上写存储。
 */
export async function readPlatformCredentialBundle(
  credentialService: Pick<ICredentialService, "load">,
  currentOrigin: string,
): Promise<PlatformCredentialBundle | null> {
  try {
    const [sessionRaw, deviceToken] = await Promise.all([
      credentialService.load(PLATFORM_SESSION_CREDENTIAL_KEY),
      credentialService.load(PLATFORM_DEVICE_TOKEN_CREDENTIAL_KEY),
    ]);
    if (!sessionRaw || !deviceToken) {
      return null;
    }
    const session = parseSession(sessionRaw);
    if (!session || session.origin !== currentOrigin) {
      return null;
    }
    return { session, deviceToken };
  } catch (error) {
    if (isCredentialDecryptError(error)) {
      return null;
    }
    throw error;
  }
}

/** 先写 device_token 再写 session：中途失败最多留下无会话的孤立 token，不会出现「有会话无凭据」。 */
export async function writePlatformCredentials(
  credentialService: Pick<ICredentialService, "save">,
  bundle: PlatformCredentialBundle,
): Promise<void> {
  await credentialService.save(PLATFORM_DEVICE_TOKEN_CREDENTIAL_KEY, bundle.deviceToken);
  await credentialService.save(PLATFORM_SESSION_CREDENTIAL_KEY, JSON.stringify(bundle.session));
}

export async function clearPlatformCredentials(
  credentialService: Pick<ICredentialService, "delete">,
): Promise<void> {
  // 删除顺序与写入相反：先删 session（getSession 立即失效），再删 token。
  await credentialService.delete(PLATFORM_SESSION_CREDENTIAL_KEY);
  await credentialService.delete(PLATFORM_DEVICE_TOKEN_CREDENTIAL_KEY);
}
