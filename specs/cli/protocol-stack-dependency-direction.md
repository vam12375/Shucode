# 协议双栈依赖方向与破环边界

## 背景与问题

`apps/shucode-cli/packages/bootstrap/src/` 下并存两套协议栈：

- 旧栈 `shucode-protocol/`（约 51 文件 / 15.3K 行）：活动 server（`server.ts` 的 `ShucodeProtocolServer`）所在，构造时挂载 v4 gateway。
- v4 栈 `shucode-protocol-v4/`（约 54 文件 / 22.4K 行）：v4 命令原生执行与投影，迁移终态。

`shucode-protocol/v4-bridge.ts:8-11` 声明的迁移契约：**依赖只允许「旧目录 → v4 目录」单向流动；v4 目录禁止 import 旧目录任何模块。** 旧栈退役（最终删除）的前提是这个方向不被反向穿透。

该环在 2026-10-12 之前被 3 处 v4→旧栈的运行时 import 违反，形成目录级依赖环：

- `shucode-protocol-v4/commands/handlers/goal-compact.ts` → `shucode-protocol/session-residency.js`
- `shucode-protocol-v4/commands/prompt-turn.ts` → 同上
- `shucode-protocol-v4/commands/handlers/session-flow.ts` → `shucode-protocol/model-execution.js`

注意：`architecture:check` 未覆盖 bootstrap 的协议目录（两者均非 managed module），上述边界仅靠本 spec 与 `v4-bridge.ts` 头注释约束，评审时必须人工核对。

## 破环方案（2026-10-12 实施）

把环所依赖的叶子能力迁入 v4 栈，使两栈恢复无环单向图：

```
shucode-protocol（旧） ──164 处 import──▶ shucode-protocol-v4
        ▲                                       │
        └──────────── ✗ 禁止反向 ───────────────┘
```

| 原位置（旧栈）                                                                                                                                                                                             | 内容                                                                       | 去向                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `shucode-protocol/model-execution.ts`（27 行）                                                                                                                                                             | `createModelExecutionContext`（两种输入协议共用的执行材料投影）            | 整体迁至 `shucode-protocol-v4/model-execution.ts`。唯一内部依赖 `../app/types.js` 属两栈共用的 `bootstrap/src/app/`，非协议栈成员 |
| `shucode-protocol/session-residency.ts` 中的 residency finalization lease（`SessionResidencyFinalizationOwner` / `acquireSessionResidencyFinalization` / `runWithSessionResidencyFinalization`，约 43 行） | detached runner 收尾窗口的 record 引用计数锁                               | 迁至 `shucode-protocol-v4/session-residency-finalization.ts`。纯逻辑、零 import                                                   |
| `shucode-protocol/session-residency.ts` 其余部分（`deactivateSessionRecord` / `createSessionResidentPoolHost` / `deactivationLogContext`）                                                                 | 常驻池去激活执行面，依赖旧栈 `server-types.ts`、`session-resident-pool.ts` | **留在旧栈原文件**，`server.ts` 继续从 `./session-residency.js` 引用                                                              |

搬迁后两份 v4 新文件均为运行时零依赖叶子（lease 无 import；`model-execution` 仅 type import），不引入任何新运行时边，运行时行为不变。

## 依赖方向契约（迁移收尾前持续有效）

1. v4 目录禁止 import 旧栈 `shucode-protocol/` 内任何模块（value 或 type import 均禁止）。
2. 旧栈 import v4 合法（既有 164 处即此方向）；旧栈退役时这些 import 随旧目录删除。
3. 两栈共用的中立层是 `bootstrap/src/app/`（runtime 类型、provider registry 等）与外部包（`@shucode/contracts`、`@shucode/shared/shucode-protocol-v4`）；协议栈内的新共享原语应放 v4 栈，由旧栈按第 2 条引用，不得再放旧栈形成新反向依赖。
4. 每次触碰两栈的改动，用 `grep -rn "shucode-protocol/" apps/shucode-cli/packages/bootstrap/src/shucode-protocol-v4/` 验证无 v4→旧 import（应零命中）。

## 旧栈退役路线图（2026-10-12 普查结论）

破环后对旧方法面做了全仓引用普查，结论：**旧栈不是死代码，整个控制面仍活**，退役必须按域渐进：

1. **活方法面（不可删）**：`shucodeAgentService.ts` 以 `shucodeProtocolMethods.*` 调用约 70 个旧方法（session CRUD/model/plugins/workflows/automation/offPeak/interaction/workspace settings）。另有约 15 个方法（automation*、interaction*、offPeak\*、computerUseOperationEvent、sessionRequestRuntimePreferences 等）是 server→client **反向请求**（`context.requestClient`），不在 server dispatch switch 里，普查时勿误判为死方法。
2. **headless 输出面（需产品决策）**：`session-mapper.ts`（1,530 行）由 headless stream-json（`cli/src/headless-workflow.ts` 经 `bootstrap.index` 的 `mapSessionEvent`）与旧 `session/subscribe` 推送消费；迁 v4 会改变 headless 输出契约。
3. **死方法面（本批删除）**：`session/fork`、`session/stop`、`session/cancelBackgroundTask`、`session/usage`、`usage/stats`（旧名）——全仓零调用（符号与字面量均无）。fork/stop 语义已由 v4 命令通道（edit/retry-fork、stop、cancelBackgroundWork→`app.cancelBackgroundTask`）承接；usage 已有 v4 名字空间（`V4_METHODS.usageStats`/`conversationUsage` 复用同一 handler 函数）。shared 注册表中 usageStats/sessionUsage 本就带 `@deprecated` 注释预告此次删除。

### 第一批删除清单（2026-10-12 实施）

- `packages/shared/src/shucode-protocol/index.ts`：注册表删 5 个方法词条；删 fork 专属 `shucodeSessionHistoryTargetSchema`、`shucodeSessionForkParamsSchema`、`shucodeSessionForkResultSchema`、`shucodeSessionStopParamsSchema`、`shucodeSessionCancelBackgroundTaskParamsSchema`、`shucodeSessionCancelBackgroundTaskResultSchema`，以及随之变孤儿的 `shucodeBackgroundTaskInfoSchema` + 其 status enum（仅被 cancel result 引用）。保留 `shucodeUsageStatsParamsSchema` / `shucodeTaskTokenUsageParamsSchema`（v4 handler 仍在用）。
- `shucode-protocol/server.ts`：删 5 个 dispatch case 与 `forkSession`/`stopSession`/`cancelBackgroundTask` 导入；v4 usage 两 case 与 handler 保留。
- `shucode-protocol/server-operations.ts`：删 `forkSession` / `stopSession` / `cancelBackgroundTask` 三个 op 与独占 helper `resolveForkTarget` / `resolveTurnMessageId` / `pauseActiveGoalForSessionStop`。**保留** `registerForkedSession`（v4-bridge fork 钩子复用，文件头注释已声明）、`ensureNoActiveTurn`（compact/goal 共用）。
- `shucode-protocol/transport.ts`：`shouldBypassProcessingQueue` 去掉 `sessionStop`，保留 `workspaceCancelGenerateText`。v4 stop 走 admission 异步设计（不等模型完成返回），不需要旁路。

### 验收场景（第一批）

1. 上述 5 方法词条 / schema / op / helper 的符号在全仓 grep 零残留。
2. `bootstrap` 包 `tsc --noEmit` 与根 `pnpm typecheck` 通过（desktop/services 引用的剩余面完好）。
3. `pnpm lint`、`pnpm architecture:check --changed` 与基线一致。

### 后续退役批次（待办，按依赖从少到多）

- headless stream-json 输出迁移（需要与产品确认 stream-json 契约的 v4 化方案）。
- session 读面（read/messages/events/subagents/list）与订阅迁 v4 topic。
- settings/workspace/plugins/workflows/automation/offPeak 各域方法随各自 UI 迁移逐步收编（每域先有 v4 等价通道，再删旧 case）。

## 验收场景（本次已验证）

1. 三处环 import 全部改为指向 v4 内新位置；旧栈 `server-operations.ts` 的 `runWithSessionResidencyFinalization` / `createModelExecutionContext` 改按 旧→v4 方向引用。
2. `pnpm typecheck` 通过；`pnpm lint` 无新增告警；`pnpm architecture:check --changed` 0 违规。
3. 上述 grep 检查零命中，目录级依赖环消除。
