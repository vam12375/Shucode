/**
 * 平台登录 init/poll 响应的解析边界。
 *
 * 与 platformAuthService 分离：解析只做「形状校验 + 收窄」，不持有登录状态；
 * 未知形状一律返回 null，由服务按 protocol 失败收口（不把半截数据当成功）。
 */
import { isPlatformDeviceToken } from "@shucode/shared";

interface PlatformAuthInitData {
  flow_id: string;
  authorize_url: string;
  expires_at: number;
  poll_interval_sec: number;
}

type PlatformAuthPollData =
  | { status: "pending" | "consumed" | "expired" | "denied" }
  | {
      status: "authorized";
      credentials: { token: string; token_id: string; token_hint: string };
      user: { id: string; email: string; display_name: string };
      teams: Array<{ id: string; name: string; role: "owner" | "member" }>;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseInitData(value: unknown): PlatformAuthInitData | null {
  if (!isRecord(value)) return null;
  const { flow_id, authorize_url, expires_at, poll_interval_sec } = value;
  if (
    typeof flow_id !== "string" ||
    !flow_id.trim() ||
    typeof authorize_url !== "string" ||
    typeof expires_at !== "number" ||
    !Number.isFinite(expires_at) ||
    typeof poll_interval_sec !== "number" ||
    !Number.isFinite(poll_interval_sec) ||
    poll_interval_sec <= 0
  ) {
    return null;
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(authorize_url);
  } catch {
    return null;
  }
  // 与 endpoint origin 解析口径一致：允许 http（本地开发）与 https。
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return null;
  }
  return {
    flow_id: flow_id.trim(),
    authorize_url: parsedUrl.toString(),
    expires_at,
    poll_interval_sec,
  };
}

export function parsePollData(value: unknown): PlatformAuthPollData | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  if (
    status !== "pending" &&
    status !== "authorized" &&
    status !== "consumed" &&
    status !== "expired" &&
    status !== "denied"
  ) {
    return null;
  }
  if (status !== "authorized") {
    return { status };
  }
  const credentials = value.credentials;
  const user = value.user;
  const teams = value.teams;
  if (
    !isRecord(credentials) ||
    typeof credentials.token !== "string" ||
    !isPlatformDeviceToken(credentials.token) ||
    typeof credentials.token_hint !== "string" ||
    !isRecord(user) ||
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    typeof user.display_name !== "string" ||
    !Array.isArray(teams)
  ) {
    return null;
  }
  return {
    status,
    credentials: {
      token: credentials.token,
      token_id: typeof credentials.token_id === "string" ? credentials.token_id : "",
      token_hint: credentials.token_hint,
    },
    user: { id: user.id, email: user.email, display_name: user.display_name },
    teams: teams.flatMap((team) => {
      if (!isRecord(team)) return [];
      const { id, name, role } = team;
      if (typeof id !== "string" || typeof name !== "string") return [];
      if (role !== "owner" && role !== "member") return [];
      return [{ id, name, role }];
    }),
  };
}

const PLATFORM_MIN_POLL_INTERVAL_MS = 1_000;
const PLATFORM_MAX_POLL_INTERVAL_MS = 15_000;

export function clampPollIntervalMs(seconds: number): number {
  return Math.min(
    Math.max(Math.round(seconds * 1000), PLATFORM_MIN_POLL_INTERVAL_MS),
    PLATFORM_MAX_POLL_INTERVAL_MS,
  );
}
