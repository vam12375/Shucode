/**
 * PlatformAuthService —— 平台账号登录的唯一流程所有者。
 *
 * 与旧 OAuth 的「renderer 轮询」不同：平台登录把 init、轮询、凭据落盘全部收敛在
 * host 服务内，renderer 只打开浏览器并 awaitLogin()。好处：
 * - 流程状态只有一份（不依赖 renderer 存活），刷新/关闭欢迎页不会丢登录；
 * - renderer 侧不需要新增 Zustand 轮询态与 Root 级 effect。
 *
 * 事件顺序：
 *   startLogin → POST init（Bearer pollToken）→ setTimeout 轮询 poll 接口
 *     pending → 下一轮；authorized → 写凭据（先 token 后 session）→ resolve
 *     网络/5xx → 指数退避（≤30s）继续；401/403/404/协议错误 → protocol 失败
 *   截止 expiresAt 未完成 → expired；cancelLogin → cancelled
 */
import { randomBytes } from "node:crypto";
import {
  ApiError,
  type ApiClient,
  type PlatformLoginResult,
  type PlatformLoginStart,
  type PlatformSessionInfo,
} from "@shucode/shared";
import type { ICredentialService } from "../credential/credential.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { IPlatformAuthService } from "./platformAuth.js";
import { clampPollIntervalMs, parseInitData, parsePollData } from "./platformAuthPayload.js";
import {
  clearPlatformCredentials,
  readPlatformCredentialBundle,
  writePlatformCredentials,
} from "./platformCredentials.js";

const serviceLog = createServiceLogger("platformAuth");

/** 服务端 flow 生命周期 10 分钟，客户端留 15s 余量收口。 */
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BACKOFF_MS = 30_000;
const POLL_REQUEST_TIMEOUT_MS = 15_000;

interface PlatformAuthServiceDependencies {
  apiClient: ApiClient;
  /** 当前 endpoint origin 解析；登录/凭据读取都以它为准。 */
  resolveEndpointOrigin: () => string | Promise<string>;
  now?: () => number;
  /** 登出时尽力移除已应用的网关 provider；失败仅告警。 */
  removeAppliedGatewayProvider?: () => Promise<void>;
  /** 登录时携带的设备信息；缺省为通用值。 */
  resolveDeviceInfo?: () => { deviceName: string; platform?: string };
  /**
   * 登录态变化通知（登录写凭据成功后、登出清凭据后）。
   * UI 经此刷新展示；回调异常只告警，不改变登录/登出结果。
   */
  onSessionChanged?: () => void;
}

interface PendingLoginFlow {
  flowId: string;
  pollToken: string;
  origin: string;
  expiresAt: number;
  /** 服务端建议的基础轮询间隔（收敛到 [1s, 15s]）。 */
  pollIntervalMs: number;
  /** 连续失败后的当前退避间隔；成功轮询后重置为基础间隔。 */
  backoffMs: number;
  timer: NodeJS.Timeout | null;
  completion: Promise<PlatformLoginResult>;
  resolveCompletion: (result: PlatformLoginResult) => void;
  settled: boolean;
}

export class PlatformAuthService implements IPlatformAuthService {
  readonly #apiClient: ApiClient;
  readonly #credentialService: ICredentialService;
  readonly #resolveEndpointOrigin: () => string | Promise<string>;
  readonly #now: () => number;
  readonly #removeAppliedGatewayProvider?: () => Promise<void>;
  readonly #resolveDeviceInfo: () => { deviceName: string; platform?: string };
  readonly #onSessionChanged?: () => void;
  #pending: PendingLoginFlow | null = null;
  #disposed = false;

  constructor(
    credentialService: ICredentialService,
    dependencies: PlatformAuthServiceDependencies,
  ) {
    this.#credentialService = credentialService;
    this.#apiClient = dependencies.apiClient;
    this.#resolveEndpointOrigin = dependencies.resolveEndpointOrigin;
    this.#now = dependencies.now ?? Date.now;
    this.#removeAppliedGatewayProvider = dependencies.removeAppliedGatewayProvider;
    this.#resolveDeviceInfo =
      dependencies.resolveDeviceInfo ?? (() => ({ deviceName: "Shucode Desktop" }));
    this.#onSessionChanged = dependencies.onSessionChanged;
  }

  #notifySessionChanged(): void {
    try {
      this.#onSessionChanged?.();
    } catch (error) {
      // 通知是观测回调：UI 刷新失败不能反向改变登录/登出事实。
      serviceLog.warn("平台登录态变更通知失败", { error });
    }
  }

  async getSession(): Promise<PlatformSessionInfo | null> {
    const bundle = await readPlatformCredentialBundle(
      this.#credentialService,
      await this.#resolveEndpointOrigin(),
    );
    return bundle?.session ?? null;
  }

  async startLogin(input?: {
    deviceName?: string;
    platform?: string;
  }): Promise<PlatformLoginStart> {
    if (this.#disposed) {
      throw new Error("PlatformAuthService 已 dispose");
    }
    this.#cancelPendingInternal();
    const origin = await this.#resolveEndpointOrigin();
    const pollToken = randomBytes(32).toString("hex");
    const deviceInfo = this.#resolveDeviceInfo();
    const initUrl = new URL("/api/v1/platform/auth/init", origin);
    let envelope: { code?: unknown; data?: unknown };
    try {
      const response = await this.#apiClient.request(initUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pollToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_name: input?.deviceName ?? deviceInfo.deviceName,
          ...((input?.platform ?? deviceInfo.platform)
            ? { platform: input?.platform ?? deviceInfo.platform }
            : {}),
        }),
      });
      if (!response.ok) {
        throw new ApiError({
          message: `Platform auth init HTTP ${response.status}`,
          url: initUrl.toString(),
          method: "POST",
          status: response.status,
        });
      }
      envelope = (await response.json()) as { code?: unknown; data?: unknown };
    } catch (error) {
      serviceLog.warn("平台登录 init 失败", { error });
      throw error;
    }
    if (envelope.code !== 0) {
      throw new Error("Platform auth init returned non-zero code");
    }
    const data = parseInitData(envelope.data);
    if (!data) {
      throw new Error("Platform auth init response is invalid");
    }

    const expiresAt = Math.min(data.expires_at * 1000, this.#now() + LOGIN_TIMEOUT_MS);
    let resolveCompletion: (result: PlatformLoginResult) => void = () => {};
    const completion = new Promise<PlatformLoginResult>((resolve) => {
      resolveCompletion = resolve;
    });
    const pending: PendingLoginFlow = {
      flowId: data.flow_id,
      pollToken,
      origin,
      expiresAt,
      pollIntervalMs: clampPollIntervalMs(data.poll_interval_sec),
      backoffMs: 0,
      timer: null,
      completion,
      resolveCompletion,
      settled: false,
    };
    this.#pending = pending;
    this.#schedulePoll(pending, 0);
    serviceLog.info("平台登录流程已启动", {
      flowId: data.flow_id,
      expiresAt,
      pollIntervalMs: pending.pollIntervalMs,
    });
    return {
      flowId: data.flow_id,
      authorizeUrl: data.authorize_url,
      expiresAt,
      pollIntervalMs: pending.pollIntervalMs,
    };
  }

  async awaitLogin(): Promise<PlatformLoginResult> {
    const pending = this.#pending;
    if (!pending) {
      return { kind: "failure", reason: "protocol" };
    }
    return pending.completion;
  }

  async cancelLogin(): Promise<void> {
    this.#cancelPendingInternal();
  }

  async logout(): Promise<void> {
    this.#cancelPendingInternal();
    await clearPlatformCredentials(this.#credentialService);
    // 凭据删除是登出事实；先广播（UI 立即回到未登录态），provider 清理是尽力而为的后续。
    this.#notifySessionChanged();
    if (this.#removeAppliedGatewayProvider) {
      try {
        await this.#removeAppliedGatewayProvider();
      } catch (error) {
        // 登出的凭据删除已成事实；provider 清理失败不能反向伪装成登出失败。
        serviceLog.warn("登出后移除网关 provider 失败", { error });
      }
    }
    serviceLog.info("平台账号已登出");
  }

  /** Host 释放时取消进行中的登录轮询（凭据已完成写入的部分不受影响）。 */
  dispose(): void {
    this.#disposed = true;
    this.#cancelPendingInternal();
  }

  #cancelPendingInternal(): void {
    const pending = this.#pending;
    if (!pending) return;
    pending.settled = true;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    this.#pending = null;
    pending.resolveCompletion({ kind: "failure", reason: "cancelled" });
  }

  #schedulePoll(pending: PendingLoginFlow, delayMs: number): void {
    if (pending.settled) return;
    const timer = setTimeout(() => {
      pending.timer = null;
      void this.#pollOnce(pending);
    }, delayMs);
    timer.unref?.();
    pending.timer = timer;
  }

  async #pollOnce(pending: PendingLoginFlow): Promise<void> {
    if (pending.settled || this.#pending !== pending) return;
    if (this.#now() >= pending.expiresAt) {
      this.#finish(pending, { kind: "failure", reason: "expired" });
      return;
    }

    const pollUrl = new URL(
      `/api/v1/platform/auth/poll/${encodeURIComponent(pending.flowId)}`,
      pending.origin,
    );
    let response: Response;
    try {
      response = await this.#apiClient.request(pollUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${pending.pollToken}` },
        signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.#scheduleRetry(pending, "network", error);
      return;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        // 轮询凭据不匹配/流程不存在是不可恢复的协议错误，重试只会持续打服务器。
        serviceLog.warn("平台登录轮询被拒", { status: response.status });
        this.#finish(pending, { kind: "failure", reason: "protocol" });
        return;
      }
      this.#scheduleRetry(pending, `http_${response.status}`, null);
      return;
    }

    let envelope: { code?: unknown; data?: unknown };
    try {
      envelope = (await response.json()) as { code?: unknown; data?: unknown };
    } catch {
      this.#scheduleRetry(pending, "invalid_json", null);
      return;
    }
    const data = envelope.code === 0 ? parsePollData(envelope.data) : null;
    if (!data) {
      this.#finish(pending, { kind: "failure", reason: "protocol" });
      return;
    }

    if (data.status === "pending") {
      pending.backoffMs = pending.pollIntervalMs;
      this.#schedulePoll(pending, pending.pollIntervalMs);
      return;
    }
    if (data.status === "denied") {
      this.#finish(pending, { kind: "failure", reason: "denied" });
      return;
    }
    if (data.status === "expired") {
      this.#finish(pending, { kind: "failure", reason: "expired" });
      return;
    }
    if (data.status === "consumed") {
      // 本客户端是唯一消费者，出现 consumed 说明流程被其它实例消费，按协议错误收口。
      this.#finish(pending, { kind: "failure", reason: "protocol" });
      return;
    }

    if (data.status !== "authorized") {
      // 上面四种状态都已收口；这里兜底保证类型收窄与未知状态按协议错误处理。
      this.#finish(pending, { kind: "failure", reason: "protocol" });
      return;
    }

    const { credentials, user, teams } = data;
    const session: PlatformSessionInfo = {
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      teams,
      origin: pending.origin,
      deviceTokenHint: credentials.token_hint,
      loginAt: new Date(this.#now()).toISOString(),
    };
    try {
      await writePlatformCredentials(this.#credentialService, {
        session,
        deviceToken: credentials.token,
      });
    } catch (error) {
      serviceLog.error("平台凭据写入失败", { error });
      this.#finish(pending, { kind: "failure", reason: "protocol" });
      return;
    }
    serviceLog.info("平台登录成功", { email: session.email, teams: teams.length });
    // 凭据已落盘，先广播再收口等待者：登录成功事实对 UI 立即可见。
    this.#notifySessionChanged();
    this.#finish(pending, { kind: "success", session });
  }

  #scheduleRetry(pending: PendingLoginFlow, reason: string, error: unknown): void {
    if (pending.settled || this.#pending !== pending) return;
    // 退避序列：2×基础间隔起步，每次翻倍封顶 30s；截止时间仍由 expiresAt 控制。
    const nextDelay = Math.min(
      (pending.backoffMs > 0 ? pending.backoffMs : pending.pollIntervalMs) * 2,
      MAX_BACKOFF_MS,
    );
    pending.backoffMs = nextDelay;
    serviceLog.debug("平台登录轮询失败，稍后重试", { reason, nextDelay, error });
    this.#schedulePoll(pending, nextDelay);
  }

  #finish(pending: PendingLoginFlow, result: PlatformLoginResult): void {
    if (pending.settled) return;
    pending.settled = true;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    if (this.#pending === pending) {
      this.#pending = null;
    }
    pending.resolveCompletion(result);
  }
}

export function createPlatformAuthService(
  credentialService: ICredentialService,
  dependencies: PlatformAuthServiceDependencies,
): PlatformAuthService {
  return new PlatformAuthService(credentialService, dependencies);
}
