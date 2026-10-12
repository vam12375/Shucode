// desktop main 侧的 task realtime 协调器进程管理器。
// 职责：拉起/销毁常驻协调器进程；把窗口 Host 的上行帧按 hostId 封装转发给协调器；
// 把协调器仲裁后的下行帧路由回目标 Host。Main 不解析任何业务负载，也不持有
// 租约/回放/路由状态（AGENTS.md：Main 只做消息转发；状态归属见
// specs/desktop/main-process-state-ownership.md）。
// Main 侧自持的唯一状态是 hostId → UtilityProcess 注册表、workspaceKeys 快照与崩溃重启
// 代际——均为进程调度元数据（崩溃重启重登记 Host 需要 workspaceKeys/deliveryKind 快照）。
import { utilityProcess as electronUtilityProcess } from "electron";
import type { UtilityProcess as ElectronUtilityProcess } from "electron";
import {
  coordinatorToMainMessageSchema,
  type TaskRealtimeHostDeliveryKind,
  type CoordinatorToMainMessage,
} from "@shucode/shared";
import { taskRealtimeCoordinatorModulePath } from "./desktopRuntimeEnv.js";

interface CoordinatorBridgeLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface RegisteredHostProcess {
  child: ElectronUtilityProcess;
  deliveryKind: TaskRealtimeHostDeliveryKind;
  /** 退出/重注册时解绑监听用。 */
  onMessage: (message: unknown) => void;
  onExit: () => void;
}

export interface TaskRealtimeCoordinatorBridge {
  registerHost(params: {
    hostId: string;
    windowId: number;
    child: ElectronUtilityProcess;
    workspaceKeys: Iterable<string>;
    deliveryKind?: TaskRealtimeHostDeliveryKind;
  }): void;
  updateHostWorkspaceKeys(hostId: string, workspaceKeys: Iterable<string>): void;
  /** 内存诊断计数器快照；由协调器周期推送，Main 侧只缓存最近一次。 */
  collectMemoryDiagnostics(): Record<string, number>;
  /** app 退出前优雅收尾：通知协调器自行退出，兜底强杀。 */
  dispose(): Promise<void>;
}

const DISPOSE_FORCE_KILL_MS = 1_500;
const CRASH_RESPAWN_DELAY_MS = 1_000;
/** 崩溃重启熔断：60s 窗口内超过 5 次即停止重启，只记日志（fail-visible），防 crash loop。 */
const CRASH_RESPAWN_WINDOW_MS = 60_000;
const CRASH_RESPAWN_MAX_PER_WINDOW = 5;

interface CoordinatorSpawnDeps {
  logger: CoordinatorBridgeLogger;
}

export function spawnTaskRealtimeCoordinator(
  deps: CoordinatorSpawnDeps,
): TaskRealtimeCoordinatorBridge {
  const hosts = new Map<string, RegisteredHostProcess>();
  const workspaceKeysByHost = new Map<string, Set<string>>();
  let coordinator: ElectronUtilityProcess | null = null;
  let disposing = false;
  let disposePromise: Promise<void> | null = null;
  let crashRespawnTimes: number[] = [];
  let lastDiagnostics: Record<string, number> = {};

  const postToCoordinator = (message: unknown): boolean => {
    if (!coordinator) return false;
    try {
      coordinator.postMessage(message);
      return true;
    } catch (error) {
      deps.logger.warn("[task-realtime-coordinator] postMessage failed:", error);
      return false;
    }
  };

  const handleCoordinatorMessage = (raw: unknown): void => {
    const parsed = coordinatorToMainMessageSchema.safeParse(raw);
    if (!parsed.success) {
      deps.logger.warn("[task-realtime-coordinator] invalid coordinator message dropped");
      return;
    }
    const msg: CoordinatorToMainMessage = parsed.data;
    switch (msg.type) {
      case "coordinator/deliver": {
        // 无状态转发：按 hostId 查注册表，不解析 message（Host 侧 bridge 会再校验）。
        hosts.get(msg.hostId)?.child.postMessage(msg.message);
        return;
      }
      case "coordinator/diagnostics":
        lastDiagnostics = msg.diagnostics;
        return;
      case "coordinator/log":
        deps.logger[msg.level](`[task-realtime-coordinator] ${msg.message}`);
        return;
    }
  };

  const reregisterAllHosts = (): void => {
    for (const [hostId, workspaceKeys] of workspaceKeysByHost) {
      const registered = hosts.get(hostId);
      if (!registered) continue;
      postToCoordinator({
        type: "coordinator/hostUp",
        hostId,
        workspaceKeys: [...workspaceKeys],
        deliveryKind: registered.deliveryKind,
      });
    }
  };

  const spawnCoordinator = (): void => {
    coordinator = electronUtilityProcess.fork(taskRealtimeCoordinatorModulePath, [], {
      serviceName: "shucode-task-realtime-coordinator",
      execArgv: ["--no-warnings"],
    });
    deps.logger.info(
      `[task-realtime-coordinator] forked coordinator process pid=${coordinator.pid}`,
    );
    coordinator.on("message", handleCoordinatorMessage);
    coordinator.once("exit", () => {
      coordinator = null;
      if (disposing) return;
      handleCoordinatorCrash();
    });
  };

  // 惰性拉起：首次 registerHost（首个窗口 Host spawn，app ready 之后）才 fork，
  // 避免模块作用域 fork 与 dev watch 构建竞态、也避免无窗口启动白白拉起进程。
  const ensureCoordinator = (): boolean => {
    if (coordinator) return true;
    if (disposing) return false;
    spawnCoordinator();
    return true;
  };

  const handleCoordinatorCrash = (): void => {
    const now = Date.now();
    crashRespawnTimes = crashRespawnTimes.filter((time) => now - time < CRASH_RESPAWN_WINDOW_MS);
    if (crashRespawnTimes.length >= CRASH_RESPAWN_MAX_PER_WINDOW) {
      deps.logger.error(
        "[task-realtime-coordinator] coordinator crashed too often; respawn disabled (realtime delivery degraded until next app restart)",
      );
      return;
    }
    crashRespawnTimes.push(now);
    deps.logger.warn(
      `[task-realtime-coordinator] coordinator exited unexpectedly; respawning in ${CRASH_RESPAWN_DELAY_MS}ms`,
    );
    // 在途镜像流由协调器的无租约隐式回收语义恢复（见 taskRealtimeBus.handleStreamOpPublish），
    // 无需 host 侧配合。
    const respawnTimer = setTimeout(() => {
      if (disposing || coordinator) return;
      // 崩溃重启：无窗口时（hosts 为空）也重新拉起，保持下一个窗口注册即用的语义。
      spawnCoordinator();
      reregisterAllHosts();
    }, CRASH_RESPAWN_DELAY_MS);
    respawnTimer.unref?.();
  };

  return {
    registerHost(params) {
      ensureCoordinator();
      const existing = hosts.get(params.hostId);
      if (existing) {
        existing.child.off?.("message", existing.onMessage);
        existing.child.off?.("exit", existing.onExit);
      }

      const onMessage = (message: unknown) => {
        postToCoordinator({ type: "coordinator/hostFrame", hostId: params.hostId, frame: message });
      };
      const onExit = () => {
        // Host 退出是 fail-hidden 边界：协调器负责释放该 host 的租约并向订阅者广播失效。
        hosts.delete(params.hostId);
        workspaceKeysByHost.delete(params.hostId);
        postToCoordinator({ type: "coordinator/hostDown", hostId: params.hostId });
      };
      params.child.on("message", onMessage);
      params.child.once("exit", onExit);

      const workspaceKeys = new Set(params.workspaceKeys);
      const deliveryKind = params.deliveryKind ?? "desktop_window";
      hosts.set(params.hostId, { child: params.child, deliveryKind, onMessage, onExit });
      workspaceKeysByHost.set(params.hostId, workspaceKeys);

      deps.logger.info("[task-realtime-coordinator] registered host", {
        hostId: params.hostId,
        windowId: params.windowId,
        workspaceKeyCount: workspaceKeys.size,
        deliveryKind,
      });

      postToCoordinator({
        type: "coordinator/hostUp",
        hostId: params.hostId,
        workspaceKeys: [...workspaceKeys],
        deliveryKind,
      });
    },

    updateHostWorkspaceKeys(hostId, workspaceKeys) {
      ensureCoordinator();
      const keys = new Set(workspaceKeys);
      workspaceKeysByHost.set(hostId, keys);
      postToCoordinator({
        type: "coordinator/hostWorkspaces",
        hostId,
        workspaceKeys: [...keys],
      });
    },

    collectMemoryDiagnostics() {
      return {
        coordinatorReachable: coordinator ? 1 : 0,
        ...lastDiagnostics,
      };
    },

    dispose() {
      disposePromise ??= new Promise((resolve) => {
        disposing = true;
        if (!coordinator) {
          resolve();
          return;
        }
        const coordinatorToDispose = coordinator;
        const forceKillTimer = setTimeout(() => {
          try {
            coordinatorToDispose.kill();
          } catch {
            // 进程已退出时 kill 失败可忽略；dispose 兜底路径不反演退出流程。
          }
          resolve();
        }, DISPOSE_FORCE_KILL_MS);
        forceKillTimer.unref?.();
        try {
          coordinatorToDispose.once("exit", () => {
            clearTimeout(forceKillTimer);
            resolve();
          });
          postToCoordinator({ type: "coordinator/shutdown" });
        } catch {
          clearTimeout(forceKillTimer);
          try {
            coordinatorToDispose.kill();
          } catch {
            // 同上：兜底 kill 失败不反演退出流程。
          }
          resolve();
        }
      });
      return disposePromise;
    },
  };
}
