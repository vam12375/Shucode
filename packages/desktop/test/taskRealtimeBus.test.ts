// TaskRealtimeBus 协调器单测：租约仲裁、攒批/立即帧、回放补齐、owner 命令路由、
// 会话消息路由、Host 退出失效与协调器重启后的无租约隐式回收。
// 运行方式：npx tsx --test test/taskRealtimeBus.test.ts（在 packages/desktop 下）。
// Host 端点全部用内存 post 回调——bus 的传输边界使协调器核心无需 Electron 即可测试。
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { TaskRealtimeBus } from "../src/taskRealtime/taskRealtimeBus.js";

const WORKSPACE_PATH = "/ws/demo";
const WORKSPACE_KEY = "/ws/demo";
const TRACE_ID = "trace-1";

interface RecordedMessage {
  type: string;
  [key: string]: unknown;
}

interface TestHost {
  hostId: string;
  sent: RecordedMessage[];
  acquireLease(taskId: string, runId?: string): RecordedMessage | undefined;
  releaseLease(taskId: string, runId?: string): void;
  publishStreamOp(taskId: string, runId: string, op: Record<string, unknown>): void;
  publishRealtimeEvent(event: Record<string, unknown>): void;
  requestOwnerCommand(
    taskId: string,
    runId: string,
    commandRequestId: string,
    commandType?: string,
  ): void;
  deliverOwnerCommandResult(commandRequestId: string, toHostId: string): void;
  sendSessionMessage(request: Record<string, unknown>): void;
  announceSessionRoute(sessionId: string): void;
  deliverSessionMessageResult(result: Record<string, unknown>): void;
}

function createBusHarness() {
  const bus = new TaskRealtimeBus({ logger: { info() {}, warn() {} } });
  const hosts = new Map<string, TestHost>();

  const registerHost = (hostId: string, workspaceKeys: string[] = [WORKSPACE_KEY]): TestHost => {
    const sent: RecordedMessage[] = [];
    bus.registerHost({
      hostId,
      workspaceKeys,
      post: (message: unknown) => {
        sent.push(message as RecordedMessage);
      },
    });
    const host: TestHost = {
      hostId,
      sent,
      acquireLease(taskId, runId = TRACE_ID) {
        bus.acceptHostFrame(hostId, {
          type: "task-run-lease-acquire",
          request: {
            leaseRequestId: `lease-${hostId}-${taskId}`,
            workspacePath: WORKSPACE_PATH,
            workspaceKey: WORKSPACE_KEY,
            taskId,
            runId,
            traceId: runId,
          },
        });
        return sent.filter((message) => message.type === "task-run-lease-result").at(-1)?.result as
          | RecordedMessage
          | undefined;
      },
      releaseLease(taskId, runId = TRACE_ID) {
        bus.acceptHostFrame(hostId, {
          type: "task-run-lease-release",
          target: {
            workspacePath: WORKSPACE_PATH,
            workspaceKey: WORKSPACE_KEY,
            taskId,
            runId,
            traceId: runId,
          },
        });
      },
      publishStreamOp(taskId, runId, op) {
        bus.acceptHostFrame(hostId, {
          type: "task-stream-op-publish",
          target: {
            workspacePath: WORKSPACE_PATH,
            workspaceKey: WORKSPACE_KEY,
            taskId,
            runId,
            traceId: runId,
          },
          op,
        });
      },
      publishRealtimeEvent(event) {
        bus.acceptHostFrame(hostId, { type: "task-realtime-publish", event });
      },
      requestOwnerCommand(taskId, runId, commandRequestId, commandType = "stop_generation") {
        bus.acceptHostFrame(hostId, {
          type: "task-owner-command-request",
          command: {
            commandRequestId,
            type: commandType,
            workspacePath: WORKSPACE_PATH,
            workspaceKey: WORKSPACE_KEY,
            taskId,
            runId,
          },
        });
      },
      deliverOwnerCommandResult(commandRequestId, toHostId) {
        bus.acceptHostFrame(hostId, {
          type: "task-owner-command-result",
          result: { commandRequestId, success: true },
        });
        void toHostId;
      },
      sendSessionMessage(request) {
        bus.acceptHostFrame(hostId, { type: "session-message-send-requested", request });
      },
      announceSessionRoute(sessionId) {
        bus.acceptHostFrame(hostId, { type: "session-route-announce", route: { sessionId } });
      },
      deliverSessionMessageResult(result) {
        bus.acceptHostFrame(hostId, { type: "session-message-deliver-result", result });
      },
    };
    hosts.set(hostId, host);
    return host;
  };

  const streamChunkOp = (taskId: string, content = "chunk") => ({
    kind: "stream_event",
    event: { type: "agent_message_chunk", taskId, traceId: TRACE_ID, content },
  });

  return { bus, registerHost, streamChunkOp };
}

const deliveredBatches = (host: TestHost) =>
  host.sent
    .filter((message) => message.type === "task-realtime-deliver")
    .map((message) => message.event as RecordedMessage);

const invalidations = (host: TestHost) =>
  deliveredBatches(host).filter((event) => event.type === "task_snapshot_invalidated");

test("租约仲裁：同 workspace+task 第二个 host 被拒绝，同 host 重入成功", () => {
  const { registerHost } = createBusHarness();
  const owner = registerHost("host-a");
  const other = registerHost("host-b");

  const first = owner.acquireLease("task-1");
  assert.equal(first?.acquired, true);

  const rejected = other.acquireLease("task-1", "trace-2");
  assert.equal(rejected?.acquired, false);
  assert.equal(rejected?.reason, "owned_by_other_host");
  assert.equal(rejected?.ownerHostId, "host-a");

  const reacquired = owner.acquireLease("task-1");
  assert.equal(reacquired?.acquired, true);
});

test("非立即流操作按 1s 攒批，owner 收 relay_owner、observer 收 observer，seq 连续", () => {
  const { registerHost, streamChunkOp } = createBusHarness();
  const owner = registerHost("host-a");
  const observer = registerHost("host-b");
  owner.acquireLease("task-1");

  owner.publishStreamOp("task-1", TRACE_ID, streamChunkOp("task-1", "a"));
  owner.publishStreamOp("task-1", TRACE_ID, streamChunkOp("task-1", "b"));

  // 未到 flush 间隔不投递。
  assert.equal(deliveredBatches(owner).length, 0);

  busAdvanceTimers(1000);

  const ownerBatches = deliveredBatches(owner).filter(
    (event) => event.type === "task_stream_mirror_batch",
  );
  const observerBatches = deliveredBatches(observer).filter(
    (event) => event.type === "task_stream_mirror_batch",
  );
  assert.equal(ownerBatches.length, 1);
  assert.equal(ownerBatches[0]?.deliveryPurpose, "relay_owner");
  assert.equal(observerBatches[0]?.deliveryPurpose, "observer");
  // 同型 text chunk 被 coalesce 合并成单 op（内容拼接），seq 仍单调连续。
  assert.deepEqual(
    ownerBatches[0]?.ops.map((op: { seq: number }) => op.seq),
    [1],
  );
  assert.equal((ownerBatches[0]?.ops[0] as { event?: { content?: string } })?.event?.content, "ab");
  // 下一批 seq 续接（首批 coalesce 后只占 seq 1），owner 与 observer 看到同一条 seq 流。
  owner.publishStreamOp("task-1", TRACE_ID, streamChunkOp("task-1", "c"));
  busAdvanceTimers(1000);
  assert.equal(
    deliveredBatches(observer).filter((event) => event.type === "task_stream_mirror_batch")[1]
      ?.fromSeq,
    2,
  );
});

test("permission_request 与终态事件立即冲刷，终态同时释放租约", () => {
  const { bus, registerHost } = createBusHarness();
  const owner = registerHost("host-a");
  const observer = registerHost("host-b");
  owner.acquireLease("task-1");

  owner.publishStreamOp("task-1", TRACE_ID, {
    kind: "stream_event",
    event: { type: "permission_request", taskId: "task-1", traceId: TRACE_ID },
  });
  const firstBatch = deliveredBatches(observer)[0];
  assert.equal(firstBatch?.type, "task_stream_mirror_batch");

  owner.publishStreamOp("task-1", TRACE_ID, {
    kind: "stream_event",
    event: { type: "task_complete", taskId: "task-1", traceId: TRACE_ID },
  });
  const terminalBatch = deliveredBatches(owner).at(-1);
  assert.equal(terminalBatch?.terminal, true);
  assert.equal(bus.collectMemoryDiagnostics().leases, 0);
});

test("owner host 退出：租约释放并向订阅者广播 snapshot invalidation", () => {
  const { bus, registerHost, streamChunkOp } = createBusHarness();
  const owner = registerHost("host-a");
  const observer = registerHost("host-b");
  owner.acquireLease("task-1");
  owner.publishStreamOp("task-1", TRACE_ID, streamChunkOp("task-1"));
  busAdvanceTimers(1000);
  assert.equal(invalidations(observer).length, 0);

  bus.unregisterHost("host-a");
  const lostInvalidations = invalidations(observer);
  assert.equal(lostInvalidations.length, 1);
  assert.equal(lostInvalidations[0]?.reason, "stream_mirror_owner_lost");
  assert.equal(lostInvalidations[0]?.taskId, "task-1");
});

test("新 host 注册回放同 workspace 的 replay 批次（fromSeq=1）", () => {
  const { registerHost, streamChunkOp } = createBusHarness();
  const owner = registerHost("host-a");
  owner.acquireLease("task-1");
  owner.publishStreamOp("task-1", TRACE_ID, streamChunkOp("task-1", "a"));
  busAdvanceTimers(1000);

  const late = registerHost("host-late");
  const replayBatches = deliveredBatches(late).filter(
    (event) => event.type === "task_stream_mirror_batch",
  );
  assert.equal(replayBatches.length, 1);
  assert.equal(replayBatches[0]?.fromSeq, 1);
  assert.equal(replayBatches[0]?.deliveryPurpose, "observer");
});

test("超大批次：owner 收分片小批，observer 收 gap invalidation，后注册者不重放大批", () => {
  const { registerHost, streamChunkOp } = createBusHarness();
  const owner = registerHost("host-a");
  const observer = registerHost("host-b");
  owner.acquireLease("task-1");

  const huge = "x".repeat(600 * 1024);
  owner.publishStreamOp("task-1", TRACE_ID, streamChunkOp("task-1", huge));
  busAdvanceTimers(1000);

  // owner 分片（至少 2 片，全部 relay_owner），observer 只收失效。
  const ownerChunks = deliveredBatches(owner).filter(
    (event) => event.type === "task_stream_mirror_batch",
  );
  assert.ok(ownerChunks.length >= 2);
  assert.ok(ownerChunks.every((event) => event.deliveryPurpose === "relay_owner"));
  assert.equal(invalidations(observer).length, 1);
  assert.equal(invalidations(observer)[0]?.reason, "stream_mirror_gap");

  // 迟到订阅者：replay 不可用 → 只收 gap invalidation，不重放超大 payload。
  const late = registerHost("host-late");
  const lateInvalidations = invalidations(late);
  assert.equal(lateInvalidations.length, 1);
  assert.equal(lateInvalidations[0]?.reason, "stream_mirror_gap");
  assert.equal(
    deliveredBatches(late).filter((event) => event.type === "task_stream_mirror_batch").length,
    0,
  );
});

test("owner 命令：路由到租约 owner，结果中继回请求方；stale run 与无 owner 被拒", () => {
  const { registerHost } = createBusHarness();
  const owner = registerHost("host-a");
  const requester = registerHost("host-b");
  owner.acquireLease("task-1");

  requester.requestOwnerCommand("task-1", TRACE_ID, "cmd-1");
  const delivered = owner.sent.find((message) => message.type === "task-owner-command-deliver");
  assert.equal((delivered?.command as RecordedMessage)?.commandRequestId, "cmd-1");
  assert.equal((delivered?.command as RecordedMessage)?.requesterHostId, "host-b");

  owner.deliverOwnerCommandResult("cmd-1", "host-b");
  const result = requester.sent.find((message) => message.type === "task-owner-command-result");
  assert.equal((result?.result as RecordedMessage)?.success, true);

  // stale runId：run 不匹配直接拒绝，不投递给 owner。
  requester.requestOwnerCommand("task-1", "trace-stale", "cmd-2");
  const staleResult = requester.sent
    .filter((message) => message.type === "task-owner-command-result")
    .at(-1)?.result as RecordedMessage;
  assert.equal(staleResult?.code, "STALE_TASK_OWNER_COMMAND");
  assert.equal(
    owner.sent.filter((message) => message.type === "task-owner-command-deliver").length,
    1,
  );

  // 无租约任务：NO_ACTIVE_TASK_OWNER。
  requester.requestOwnerCommand("task-unknown", TRACE_ID, "cmd-3");
  const noOwnerResult = requester.sent
    .filter((message) => message.type === "task-owner-command-result")
    .at(-1)?.result as RecordedMessage;
  assert.equal(noOwnerResult?.code, "NO_ACTIVE_TASK_OWNER");
});

test("会话消息：按 route 路由到目标 host，结果中继回源 host；未知会话直接失败", () => {
  const { registerHost } = createBusHarness();
  const source = registerHost("host-a");
  const target = registerHost("host-b");

  source.sendSessionMessage({
    requestId: "req-1",
    toSessionId: "session-1",
    content: "hello",
    createdAt: new Date(0).toISOString(),
    fromSessionId: "session-0",
    messageId: "msg-0",
  });
  const failed = source.sent
    .filter((message) => message.type === "session-message-delivery-result")
    .at(-1)?.result as RecordedMessage;
  assert.equal(failed?.status, "failed");

  target.announceSessionRoute("session-1");
  source.sendSessionMessage({
    requestId: "req-2",
    toSessionId: "session-1",
    content: "hello",
    createdAt: new Date(0).toISOString(),
    fromSessionId: "session-0",
    messageId: "msg-1",
  });
  const deliver = target.sent.find((message) => message.type === "session-message-deliver");
  assert.equal((deliver?.request as RecordedMessage)?.requestId, "req-2");

  target.deliverSessionMessageResult({
    requestId: "req-2",
    messageId: "msg-1",
    sessionId: "session-1",
    status: "success",
  });
  const success = source.sent
    .filter((message) => message.type === "session-message-delivery-result")
    .at(-1)?.result as RecordedMessage;
  assert.equal(success?.status, "success");
});

test("实时事件按 eventId 去重，重复 publish 只投递一次", () => {
  const { registerHost } = createBusHarness();
  const owner = registerHost("host-a");
  const observer = registerHost("host-b");

  const event = {
    eventId: "evt-1",
    type: "workspace_task_list_invalidated",
    reason: "task_status_changed",
    workspacePath: WORKSPACE_PATH,
    workspaceKey: WORKSPACE_KEY,
    traceId: TRACE_ID,
    createdAt: Date.now(),
  };
  owner.publishRealtimeEvent(event);
  owner.publishRealtimeEvent(event);

  assert.equal(deliveredBatches(observer).length, 1);
});

test("协调器重启恢复：无租约时的流操作隐式回收租约；已有租约维持 stale 防护", () => {
  const { bus, registerHost, streamChunkOp } = createBusHarness();
  // fresh bus = 协调器重启后的账本空态。仍在 publish 的 host 就是真实 owner。
  const recoveredOwner = registerHost("host-a");
  recoveredOwner.publishStreamOp("task-1", TRACE_ID, streamChunkOp("task-1", "resume"));
  busAdvanceTimers(1000);
  const batches = deliveredBatches(recoveredOwner).filter(
    (event) => event.type === "task_stream_mirror_batch",
  );
  assert.equal(batches.length, 1);
  assert.equal(bus.collectMemoryDiagnostics().leases, 1);

  // 已有租约时，非 owner / 非 runId 的 publish 仍被丢弃（stale 防护不变）。
  const other = registerHost("host-b");
  other.publishStreamOp("task-1", "trace-zombie", streamChunkOp("task-1", "zombie"));
  busAdvanceTimers(1000);
  assert.equal(batches.length, 1);
});

let mockedTimers: { tick: (ms: number) => void } | null = null;
function busAdvanceTimers(ms: number): void {
  if (!mockedTimers) {
    throw new Error("timers not mocked; enable in beforeEach");
  }
  mockedTimers.tick(ms);
}

beforeEach((t) => {
  const mockTimers = t.mock.timers;
  mockTimers.enable({ apis: ["setTimeout"] });
  mockedTimers = { tick: (ms: number) => mockTimers.tick(ms) };
});
