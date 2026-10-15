import type { PlatformLoginResult, PlatformLoginStart, PlatformSessionInfo } from "@shucode/shared";
import { ServiceChannels } from "@shucode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/**
 * 平台账号（多租户 SaaS）认证服务。
 *
 * 在 host process 中运行：init/轮询/凭据落盘都在服务内完成（登录流程唯一所有者），
 * renderer 只负责打开浏览器并 awaitLogin() 等待结果；浏览器深链回调只唤醒窗口。
 */
export interface IPlatformAuthService {
  /** 读取当前 endpoint 的平台登录态；origin 不一致或凭据损坏返回 null。 */
  getSession(): Promise<PlatformSessionInfo | null>;

  /**
   * 发起平台设备登录：POST init 并启动服务内轮询。
   * 返回 authorizeUrl 供调用方打开系统浏览器；已有 pending flow 时静默取消旧的。
   */
  startLogin(input?: { deviceName?: string; platform?: string }): Promise<PlatformLoginStart>;

  /**
   * 等待当前登录流程结束（成功/失败/取消/过期）。
   * 无进行中的流程时返回 protocol 失败；renderer 刷新后登录仍会在服务内完成并落盘。
   */
  awaitLogin(): Promise<PlatformLoginResult>;

  /** 取消当前登录流程（服务端 flow 自然过期，不额外请求）。 */
  cancelLogin(): Promise<void>;

  /** 删除本机平台凭据，并尽力移除已应用的网关 provider。 */
  logout(): Promise<void>;
}

export const IPlatformAuthService = createServiceDescriptor<IPlatformAuthService>(
  ServiceChannels.PlatformAuth,
);
