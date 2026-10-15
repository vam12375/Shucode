/**
 * usePlatformLogin —— 平台账号（多租户 SaaS）登录 UI 状态。
 *
 * 登录流程（init/轮询/凭据落盘）由 Host 的 PlatformAuthService 独占；
 * 本 hook 只做：打开浏览器 → awaitLogin() → 状态收敛与登录后同步触发。
 * 因此不存在 renderer 侧轮询，组件卸载也不会中断登录（服务继续完成并落盘）。
 */
import { useCallback, useRef, useState } from "react";
import type { PlatformSessionInfo } from "@shucode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";

type PlatformLoginStatus = "idle" | "waiting" | "error";

export function usePlatformLogin(
  options: {
    onSuccess?: (session: PlatformSessionInfo) => void | Promise<void>;
  } = {},
) {
  const { platformAuthService, platformUserConfigService } = useServices();
  const platform = usePlatform();
  const [status, setStatus] = useState<PlatformLoginStatus>("idle");
  const attemptRef = useRef(0);
  const onSuccessRef = useRef(options.onSuccess);
  onSuccessRef.current = options.onSuccess;

  const startLogin = useCallback(async () => {
    if (!platformAuthService) {
      return;
    }
    const attempt = ++attemptRef.current;
    setStatus("waiting");
    try {
      const started = await platformAuthService.startLogin();
      if (attemptRef.current !== attempt) {
        return;
      }
      platform.openExternal(started.authorizeUrl);
      const result = await platformAuthService.awaitLogin();
      if (attemptRef.current !== attempt) {
        return;
      }
      if (result.kind === "success") {
        setStatus("idle");
        // 登录成功后立即拉一次用户级配置（把网关 provider/模型写进 personal 层）；
        // 周期刷新由 Host 服务自持，这里失败也不改变登录成功事实。
        void platformUserConfigService
          ?.refresh()
          .catch((error) => logger.warn("[usePlatformLogin] 首次用户配置同步失败", { error }));
        await onSuccessRef.current?.(result.session);
        return;
      }
      if (result.reason === "cancelled") {
        setStatus("idle");
        return;
      }
      logger.info("[usePlatformLogin] 平台登录失败", { reason: result.reason });
      setStatus("error");
    } catch (error) {
      if (attemptRef.current !== attempt) {
        return;
      }
      logger.error("[usePlatformLogin] 启动平台登录失败", { error });
      setStatus("error");
    }
  }, [platform, platformAuthService, platformUserConfigService]);

  const cancel = useCallback(async () => {
    attemptRef.current += 1;
    try {
      await platformAuthService?.cancelLogin();
    } catch (error) {
      logger.warn("[usePlatformLogin] 取消平台登录失败", { error });
    }
    setStatus("idle");
  }, [platformAuthService]);

  return {
    /** 当前 Host 是否提供平台登录服务（旧 server wire / 测试 double 可能没有）。 */
    available: Boolean(platformAuthService),
    status,
    startLogin,
    cancel,
  };
}
