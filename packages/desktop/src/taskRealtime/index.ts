// 常驻 task realtime 协调器进程：由 desktop main 通过 electronUtilityProcess.fork 拉起。
// 职责（跨窗口 Host 的 task/session 实时协调，从 main 进程下沉，见
// specs/desktop/main-process-state-ownership.md）：
//   - task run 租约仲裁（workspace+task 键，owner = hostId，stale run 防护）
//   - 流镜像攒批（1s 合并、超大分片）与回放缓冲（60 批 / 512KB），新订阅 Host 补齐
//   - 跨窗口 owner 命令与会话消息路由（pending 超时裁决）
//   - Host 退出时释放其租约并向订阅者广播 snapshot invalidation
// Main 只按 hostId 做无状态帧转发；本进程不解析业务负载以外的内容，帧协议见
// @shucode/shared 的 task-realtime-coordinator。
import {
  mainToCoordinatorMessageSchema,
  type CoordinatorDeliverMessage,
  type CoordinatorToMainMessage,
} from "@shucode/shared";
import { TaskRealtimeBus } from "./taskRealtimeBus.js";

const DIAGNOSTICS_PUSH_INTERVAL_MS = 30_000;

const { parentPort } = process;
if (!parentPort) {
  // 只允许被 main 以 UtilityProcess 拉起；直接 node 运行没有意义。
  throw new Error("task realtime coordinator must run inside an Electron UtilityProcess");
}

const postToMain = (message: CoordinatorToMainMessage): void => {
  parentPort.postMessage(message);
};

const bus = new TaskRealtimeBus({
  logger: {
    info: (message, ...rest) =>
      postToMain({ type: "coordinator/log", level: "info", message: formatLog(message, rest) }),
    warn: (message, ...rest) =>
      postToMain({ type: "coordinator/log", level: "warn", message: formatLog(message, rest) }),
  },
});

function formatLog(message: unknown, rest: unknown[]): string {
  if (rest.length === 0) return String(message);
  try {
    return `${String(message)} ${JSON.stringify(rest)}`;
  } catch {
    return String(message);
  }
}

let diagnosticsTimer: ReturnType<typeof setInterval> | null = null;

function pushDiagnostics(): void {
  postToMain({ type: "coordinator/diagnostics", diagnostics: bus.collectMemoryDiagnostics() });
}

diagnosticsTimer = setInterval(pushDiagnostics, DIAGNOSTICS_PUSH_INTERVAL_MS);
diagnosticsTimer.unref?.();

function dispose(): void {
  if (diagnosticsTimer) {
    clearInterval(diagnosticsTimer);
    diagnosticsTimer = null;
  }
  process.exit(0);
}

parentPort.on("message", (event: Electron.MessageEvent) => {
  const parsed = mainToCoordinatorMessageSchema.safeParse(event.data);
  if (!parsed.success) {
    postToMain({
      type: "coordinator/log",
      level: "warn",
      message: `[task-realtime] invalid main-to-coordinator message dropped`,
    });
    return;
  }

  switch (parsed.data.type) {
    case "coordinator/hostUp": {
      // 闭包内保留收窄：parsed.data 的属性链收窄不进箭头函数体，先落 const 再捕获。
      const hostUp = parsed.data;
      bus.registerHost({
        hostId: hostUp.hostId,
        workspaceKeys: hostUp.workspaceKeys,
        deliveryKind: hostUp.deliveryKind,
        post: (message) =>
          postToMain({
            type: "coordinator/deliver",
            hostId: hostUp.hostId,
            // bus 构建的下行帧即 hostIncomingMessage 契约形态；post 回调签名是 unknown
            // 出口边界，这里收口（Main 转发前仍按 hostIncomingMessageSchema 校验）。
            message: message as CoordinatorDeliverMessage["message"],
          }),
      });
      return;
    }
    case "coordinator/hostDown":
      bus.unregisterHost(parsed.data.hostId);
      return;
    case "coordinator/hostWorkspaces":
      bus.updateHostWorkspaceKeys(parsed.data.hostId, parsed.data.workspaceKeys);
      return;
    case "coordinator/hostFrame":
      bus.acceptHostFrame(parsed.data.hostId, parsed.data.frame);
      return;
    case "coordinator/shutdown":
      dispose();
      return;
  }
});
