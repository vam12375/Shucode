/**
 * usePlatformSession —— 平台账号（多租户 SaaS）登录态的 UI 投影。
 *
 * 唯一所有者是 Host 的 PlatformAuthService；本 hook 只做两件事：
 * - 读取 getSession() 得到展示用会话（不含设备凭据）；
 * - 订阅 platform:session-changed 广播，在登录成功 / 登出后刷新投影。
 * 因此 welcome 页登录完成、其它窗口登录/登出都会让本窗口的展示自动收敛。
 */
import { useCallback, useEffect, useState } from "react";
import type { PlatformSessionInfo } from "@shucode/shared";
import { PLATFORM_SESSION_CHANGED_BROADCAST_CHANNEL } from "@shucode/shared";
import { useServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";

export interface PlatformSessionView {
  /** Host 未提供平台服务（旧 server wire / 测试 double）时为 false，调用方应回退旧展示。 */
  available: boolean;
  /** null 表示未登录；读取完成前也为 null，配合 available 使用。 */
  session: PlatformSessionInfo | null;
  /** 退出平台登录（删除本机凭据并尽力移除网关 provider）。 */
  logout: () => Promise<void>;
}

export function usePlatformSession(): PlatformSessionView {
  const { platformAuthService, broadcastService } = useServices();
  const [session, setSession] = useState<PlatformSessionInfo | null>(null);

  const refresh = useCallback(async () => {
    if (!platformAuthService) {
      return;
    }
    try {
      setSession(await platformAuthService.getSession());
    } catch (error) {
      logger.warn("[usePlatformSession] 读取平台登录态失败，按未登录展示", { error });
    }
  }, [platformAuthService]);

  useEffect(() => {
    void refresh();
    const disposable = broadcastService.onMessage((message) => {
      if (message.channel !== PLATFORM_SESSION_CHANGED_BROADCAST_CHANNEL) {
        return;
      }
      void refresh();
    });
    return () => {
      disposable.dispose();
    };
  }, [broadcastService, refresh]);

  const logout = useCallback(async () => {
    if (!platformAuthService) {
      return;
    }
    try {
      // 服务内登出后会广播 session-changed，本 hook 经订阅收敛，不在此直接写状态。
      await platformAuthService.logout();
    } catch (error) {
      logger.error("[usePlatformSession] 平台退出登录失败", { error });
      // 失败也要回收一次真实状态，避免 UI 停留在乐观展示上。
      await refresh();
    }
  }, [platformAuthService, refresh]);

  return {
    available: Boolean(platformAuthService),
    session,
    logout,
  };
}
