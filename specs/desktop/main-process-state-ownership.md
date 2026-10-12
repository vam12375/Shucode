# Main 进程状态归属审计与 realtime 协调器下沉方案

## 背景与审计范围

AGENTS.md 红线：Main「负责窗口、原生操作、进程调度和消息转发，不承载 task/session 业务状态」；「外部 relay 与 Main 只做鉴权、配对、心跳、转发及 attachment 调度，不保存任务队列、快照等业务状态」。

2026-10-12 对报告（代码优化分析报告-2026-10-12.md P0#2）点名的四处逐一做了数据流核对，结论：

| 状态                                                                                                                           | 位置                                | 判定        | 依据                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hostRunningTaskCountMap`                                                                                                      | `main/index.ts:632`                 | ✅ 合规     | Host 上报的**每进程标量**，仅供退出守卫（`shouldBlockQuit`）与 tray `isShucodeBusy`。属 AGENTS.md 明示的 Main 职责「进程调度」，不承载任务队列/快照/路由                                                                                                                                                                                |
| `windowUnreadCountMap`                                                                                                         | `main/index.ts:622`                 | ✅ 合规     | 仅消费方是 dock 徽标聚合（`syncApplicationUnreadBadge`）与关窗清理。属 Main 职责「窗口、原生操作」                                                                                                                                                                                                                                      |
| `desktopRemoteSessions`（`routesBySessionId` 等）                                                                              | `main/desktopRemoteSessions.ts:136` | ✅ 合规     | 持有的是 **MessagePortMain 物理路由**（sessionId → port）、in-flight 握手、reconnect promise 去重。AGENTS.md 明文允许 Main 做「attachment 调度」；业务态（队列/快照/连接状态机）在 Host 侧 `windowRemoteConnectionRegistry`（逻辑层）与 Host attachment（运行时）。两层互补不重叠：Main 管"哪条端口连到哪"，Host 管"连接活着意味着什么" |
| `TaskRealtimeBus`（`leases` / `streamBatches` / `sessionRoutes` / `pendingOwnerCommands` / `pendingSessionMessageDeliveries`） | `main/taskRealtimeBus.ts:122`       | ❌ **违规** | 租约仲裁、回放快照缓冲（60 批 / 512KB）、会话→Host 路由、owner 命令与会话消息投递全部在 Main。这是任务/会话业务状态，且 `streamBatches.replay` 就是「快照」字面意义                                                                                                                                                                     |

### 事实基础（设计前必须知道）

- `registerHost` 全仓唯一调用点是每窗口 Host spawn（`desktopHostProcess.ts:745`）；实践中的 Host 集合 = 窗口集合，`deliveryKind` 恒为缺省 `desktop_window`。`relay_bridge` 枚举成员在 shared 中定义但全仓从未接线（手机远控按 AGENTS.md 走既有 Host attachment，不另起 Host）。
- 因此 bus 的仲裁是**多窗口 Host 之间**的：跨窗口 owner 命令、跨窗口会话消息、新窗口订阅时对进行中 run 的回放补齐。

## 违规点的事件顺序图（现状）

```
窗口 A Host（owner）        Main: TaskRealtimeBus            窗口 B Host（observer）
      │  stream op publish  │                                   │
      ├────────────────────▶│ leases 鉴权（workspace+task+run） │
      │                      │ streamBatches 攒批（1s）/合并且切片│
      │                      │ replay 缓冲（60批/512KB）          │
      │                      ├───── mirror batch ───────────────▶│
      │◀──── mirror batch（relay_owner，与 observer 同一条 seq 流）┤
      │                      │                                   │
窗口 B：owner 命令请求        │                                   │
      ├────────────────────▶│ 查 leases.ownerHostId → A         │
      │                      ├── TaskOwnerCommandDeliver ───────▶│ (A)
      │◀── result ───────────┤◀── result ────────────────────────┤
      │                      │                                   │
新窗口 C 注册                 │                                   │
                             │ replayVisibleRunsToHost(C)：      │
                             │   replay 全量回放 或 gap 快照失效  │
Host A 退出                   │                                   │
                             │ releaseLeasesForHost(A) +          │
                             │ snapshot invalidation(广播)        │
```

**不变量（迁移任何一步都必须保持）**：

1. owner 命令的 stale run 防护：`runId` 不匹配即 `STALE_TASK_OWNER_COMMAND`，不能放宽为"谁都想一想"。
2. mirror seq 连续性：owner 依赖连续 seq 渲染，gap 只能用 `task_snapshot_invalidated` + watermark 表达（oversized 分片与 replay 不可用路径已固化此语义）。
3. Host 退出时：其拥有的 lease 全部释放 + 全体订阅者收到 `stream_mirror_owner_lost` 失效。
4. 去重：`seenEventIds`（1000 窗口 LRU）继续挡跨路径重复帧。
5. desktop-continuous（实时流）与 web-remote-replayable（恢复流）两种语义都要过以上 4 条验证。

## 目标架构（推荐）：专用协调器进程

**选型**：把 bus 的状态搬进一个**专用常驻协调器 UtilityProcess**（复用 cron scheduler 的既有模式：`desktopRuntimeEnv` 暴露 module path，`spawnCronScheduler` 先例），Main 只保留无状态帧转发。备选"owner-side 状态 + 广播仲裁"被否决：跨窗口租约仲裁需要广播-收集协议，Main 必须用超时汇总应答（AGENTS.md 禁止用超时掩盖同步），而单协调器保留确定性仲裁语义，风险面最小。

```
窗口 Host A ──host frame──▶ Main（无状态转发，按 hostId/进程注册表）──▶ 协调器进程
窗口 Host B ◀──deliver frame── Main ◀──arbitrated frame────────────── 协调器进程
                                ▲
                     帧协议沿用 HostMessageTypes/HostResponseTypes
                     （shared/src 已定义，协调器只是换个消费进程）
```

- 协调器退出 = 所有租约/回放丢失：Main 检测 exit 后向全部 Host 广播 `task_snapshot_invalidated`（reason 扩一个 `coordinator_lost`），Host 走既有快照补齐路径。这与现在 Host 退出释放租约的 fail-hidden 边界同构。
- `collectMemoryDiagnostics` / `getHostDeliveryKindForTest` 经 Main 的注册表代理。

### 迁移批次

1. **批次 1（无行为变化，已实施）**：完成上述四状态归属审计并在 `taskRealtimeBus.ts` 文件头固化协调器契约（帧边界、目标进程形态、过渡态声明）。物理目录移动经核实**不能单独先行**：`tsconfig.main.json` 以 `rootDir: src/main` 编译主进程并按该路径打包，scheduler 的先例是「独立 tsconfig 工程 + module path spawn + Main 零 import」三位一体——目录移动、进程拆分与 main 解 import 必须一批原子完成，否则破坏主进程构建。
2. **批次 2（已实施，2026-10-12）**：按 scheduler 模式一次原子完成：
   - `src/taskRealtime/taskRealtimeBus.ts`：bus 类移入，`ElectronUtilityProcess` 抽象为注入的 `post` 回调（传输边界），logger 必选注入；`handleHostMessage` 改为公开 `acceptHostFrame`。
   - `src/taskRealtime/index.ts`：协调器入口（`process.parentPort` 收 Main 帧协议，dispatch 到 bus；30s 推送内存诊断；`coordinator/shutdown` 优雅退出）。
   - `packages/shared/src/task-realtime-coordinator.ts`：Main↔协调器 envelope 协议（zod strict，双向 discriminatedUnion；Host 上行帧内嵌 `hostResponseMessageSchema`，下行帧内嵌 `hostIncomingMessageSchema`，Main 不解析业务负载）。
   - `main/desktopTaskRealtimeCoordinator.ts`：Main 侧 bridge——惰性 fork（首个窗口 Host 注册时）、hostId→process 注册表、workspaceKeys/deliveryKind 快照、双向帧转发；协调器意外退出 → 1s 后重启 + 重登记全部 Host（60s 窗口 5 次熔断防 crash loop）；app 退出路径与 cron scheduler 并行 dispose（1.5s 兜底强杀）。
   - 构建接线：`tsconfig.taskRealtime.json`（rootDir `src/taskRealtime`，references shared）+ tsup `taskRealtime` target（`out/taskRealtime/index.js`，electron-builder 的 `out/**` 全量打包自动覆盖）+ `desktopRuntimeEnv.taskRealtimeCoordinatorModulePath` + dev ready marker。
   - **崩溃恢复语义**：协调器重启后租约账本清空；租约生命周期本就是「run 开始 acquire / 结束 release」，故 `handleStreamOpPublish` 在**无既有租约**时允许发布方隐式回收（`claimLeaseForStreamRecovery`，日志可辨），在途镜像流不冻结；已有租约时维持严格 owner/runId 校验（stale 防护不变）。spec 原设计的 `coordinator_lost` reason 未采用——隐式回收 + TaskRealtimePublish 通道（无租约依赖）覆盖任务状态更新，无需新增 host 侧语义。
   - 验证：bus 单测 10/10（`test/taskRealtimeBus.test.ts`，内存端点覆盖租约仲裁/攒批 coalesce/立即帧/终态释放/退出失效/回放补齐/oversized 分片/owner 命令 stale 拒绝/会话路由/去重/重启回收）；`pnpm typecheck`、根 lint（与基线一致）、`architecture:check` 0 违规、`npx tsup` 任务 target 构建成功。
   - **E2E 未做**（仓库无桌面 E2E 基建）：多窗口流式、跨窗口 owner 命令、协调器 kill 演练、手机 replayable 恢复需按上表手工验证后再放量。
3. **批次 3（清理，随批次 2 一并完成）**：`main/index.ts` 的 `new TaskRealtimeBus` 已改 `spawnTaskRealtimeCoordinator`；`desktopHostProcess` 依赖注入类型改为 `TaskRealtimeCoordinatorBridge`；`collectMemoryDiagnostics` 走协调器 30s 推送的快照（诊断注册表本就 60s 采样，快照语义匹配）；死测试钩子 `getHostDeliveryKindForTest` 已删除。

### 开放问题（批次 2 前需确认）

- 产品是否保证 workspace→单窗口（`focusWorkspaceInExistingWindow` 暗示是）？若是，租约冲突分支在生产几乎不可达，可简化仲裁日志；若否，保持现状语义（批次 2 未改动仲裁语义）。
- `relay_bridge` 死枚举成员：手机 relay 若未来需要直连协调器，协议已预留 `deliveryKind` 透传，不实现逻辑。

## 验收场景（批次 1）

1. 四状态归属审计结论落 spec；`taskRealtimeBus.ts` 文件头固化协调器契约（帧边界 + 过渡态声明 + 目标形态）。
2. 零行为变化：`pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 与基线一致。
