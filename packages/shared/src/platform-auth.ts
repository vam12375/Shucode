/**
 * 平台账号（多租户 SaaS）线上契约。
 *
 * 与平台仓库 shucode-platform 的 `packages/contracts/src/platform-auth.ts` 对齐：
 * init → 浏览器登录/授权 → 客户端轮询领取设备凭据；浏览器回跳
 * `zcode://platform/callback?flow_id=…` 只负责唤醒窗口，凭据不经 URL。
 */

/** 平台设备凭据前缀（与平台侧签发规则一致）。 */
export const PLATFORM_DEVICE_TOKEN_PREFIX = "mdp_";

/** 平台团队归属。 */
export interface PlatformAuthTeam {
  id: string;
  name: string;
  role: "owner" | "member";
}

/** 平台登录成功后的会话展示信息（凭据本体单独存 platform:device_token）。 */
export interface PlatformSessionInfo {
  userId: string;
  email: string;
  displayName: string;
  teams: readonly PlatformAuthTeam[];
  /** 登录时的平台 endpoint origin；与当前 endpoint 不一致时视为未登录。 */
  origin: string;
  deviceTokenHint: string;
  /** ISO 时间戳。 */
  loginAt: string;
}

/** 发起平台登录的返回。 */
export interface PlatformLoginStart {
  flowId: string;
  authorizeUrl: string;
  /** Unix 毫秒。 */
  expiresAt: number;
  /** 服务端建议的轮询间隔（毫秒），客户端可收敛到合理区间。 */
  pollIntervalMs: number;
}

/** 平台登录失败原因；UI 按此映射文案（不展示服务端原文）。 */
export type PlatformLoginFailureReason =
  | "expired"
  | "denied"
  | "cancelled"
  | "protocol"
  | "network";

export type PlatformLoginResult =
  | { kind: "success"; session: PlatformSessionInfo }
  | { kind: "failure"; reason: PlatformLoginFailureReason };

/** 深链回调 URL 构造（与平台 authorize 页一致）。 */
export function buildPlatformDeepLinkCallbackUrl(flowId: string): string {
  return `zcode://platform/callback?flow_id=${encodeURIComponent(flowId)}`;
}

export function isPlatformDeviceToken(value: string): boolean {
  return value.startsWith(PLATFORM_DEVICE_TOKEN_PREFIX) && value.length >= 8;
}

/** 平台网关 Provider 的固定身份（与平台 user-config 下发一致）。 */
export const PLATFORM_GATEWAY_PROVIDER_ID = "platform:gateway";

/** 用户级配置下发路由（Bearer 平台设备凭据）。 */
export const PLATFORM_USER_CONFIG_API_PATH = "/api/v1/client/user-config";

/**
 * 平台登录态变化的广播通道。
 * PlatformAuthService 在登录成功写入凭据、登出清理凭据后广播；
 * UI（侧栏账号区等）订阅后刷新展示，单一所有者仍是 Host 服务。
 */
export const PLATFORM_SESSION_CHANGED_BROADCAST_CHANNEL = "platform:session-changed";
