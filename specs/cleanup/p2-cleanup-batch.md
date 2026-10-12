# P2 清理批次（2026-10-12）

报告《代码优化分析报告-2026-10-12》第六章第 6 项「清理」的落地记录。该批次含六小项，其中「把 model-option-map/shucode-cua 纳入 typecheck」已在 [specs/desktop/desktop-typecheck-gate.md](../desktop/desktop-typecheck-gate.md) 的 P2 收尾章节完成，本文记录其余五项。

## 1. 补 unlisted dependencies（8/8，knip 段落已消失）

| 依赖                        | 消费点                                                                       | 声单位置                      | 版本依据                                                |
| --------------------------- | ---------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------- |
| `zod`                       | desktop host 的 storagePreparationProcesses / tasksStorageWorker 直接 import | packages/desktop dependencies | `4.6.5` 精确，与 shared/services 一致                   |
| `builder-util-runtime`      | desktop main manifestUpdateProvider（公开类型）                              | packages/desktop dependencies | `^9.5.1`（electron-updater 传递链实测版本）             |
| `vite`                      | packages/ui/vite/pdfJsCMapsPlugin（desktop vite.config 直接 import）         | packages/ui devDependencies   | `^8.0.2`，与 desktop/web 一致；插件唯一 vite 依赖是类型 |
| `lucide-react`              | packages/web ConversationShareLandingPage 直接 import                        | packages/web dependencies     | `^1.17.0`，与 ui 一致                                   |
| `yaml`                      | 根 scripts/architecture/policy.mjs                                           | 根 devDependencies            | `^2.9.0`，与 core 一致                                  |
| `yazl`                      | 根 scripts/package-native-search-tools.mjs                                   | 根 devDependencies            | `^3.3.1`（desktop 同款）                                |
| `@modelcontextprotocol/sdk` | node-repl-host cua-bridge（import type CallToolResult）                      | node-repl-host dependencies   | `^1.29.0`（原经 shadcn 传递）                           |

注：package.json 不支持注释，说明写在本 spec；插入声明时不得给 package.json 加 `//`（pnpm 解析会失败）。

## 2. 删 ui 死重依赖（11 个，全部逐项 grep 验证后删除）

删除：`@dnd-kit/dom`、`@dnd-kit/helpers`、`@dnd-kit/react`（dnd-kit 迁移残留，`@dnd-kit/core` 仍在用）、`@radix-ui/react-radio-group`（ui 已统一用 `radix-ui` 包）、`@stripe/react-stripe-js`、`@stripe/stripe-js`、`embla-carousel-react`、`highlight.js`、`marked`、`media-chrome`、`react-jsx-parser`。

验证方法（防 knip 假阳性与隐式引用）：源码 import 精确匹配 + 全名宽松匹配（`marked` 的 26 处命中全部为 `markedLines` 子串）+ web components 标签名排查（media-chrome）+ 消费方 package.json 声明检查（npm 层面 10/10 零命中）。

**保留的 knip 假阳性**（已实证有引用，勿删）：`@xyflow/react`（7 处）、`@rive-app/react-webgl2`、`ansi-to-react`、`use-stick-to-bottom`、`@radix-ui/react-use-controllable-state`。`marked` 在 cli/core 的包内声明保留（另一处消费者）。

## 3. 日志统一到 createServiceLogger（5 文件，console 清零）

| 文件                                             | 修法                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/oauth/oauthService.ts`                 | 22 处 console.log shim `log()` → `serviceLog.info(undefined, ...)`（忠实迁移通道，不重分类级别）；删除 shim 与 `formatLogPrefix` import                               |
| `services/setting/settingService.ts`             | `log`→`serviceLog.info`、`debugLog`→`serviceLog.debug`（debug 门禁由 serviceLogger 内置的 isEffectiveDevelopmentNodeEnv 承担，行为等价）；删除两个 shim 与相关 import |
| `services/oauth/providers/zaiProviderAdapter.ts` | 3 处 `log()` → `serviceLog.info`，scope `zaiOAuth` 保留                                                                                                               |
| `services/mcp-sync/mcpSyncService.ts`            | 裸 `console.warn` → `serviceLog.warn`（新建 scope mcpSyncService）                                                                                                    |
| `services/shucode-agent/shucodeAgentService.ts`  | 裸 `console.warn` → 既有 `logger.warn`；删除 `formatLogPrefix` import                                                                                                 |

## 4. 清 61 条 lint warning（61 → 0，无新增 disable 膨胀）

- **50 条 no-unused-vars**：17 处纯 unused import 删除；`services/node.ts` 的 `commandsService`/`hooksService`/`memoryService` 三个死实例化删除（核实 factory 纯函数无副作用，真实注册在同文件 2560+ 行的内联调用）；`desktopWindowLifecycle` 的 `browserWindowId`、electron-builder 的 `desktopElectronVersion`、prepare-agent-node-bundle 的 `adaptersRoot`、askUserQuestion 的死 interface 删除；11 处解构 props 未使用 binding 删除（核实无 rest 排除语义）；2 处位置参数 `_` 前缀（rpc/proxy-channel、rpc example）。
- **2 条 no-unsafe-finally**（`tasksDatabase/startup.ts`）：原为「finally 内守卫式 throw」（语义正确但属 lint 警示陷阱）。重构为显式收尾阶段：close 总是执行、失败仅在无首因时浮出、首因优先——与原文「close 失败不能覆盖已提交/首因」注释语义逐条等价。
- **2 条 no-this-alias**（`rpc/ipc.ts`）：`getChannel` 的对象字面量方法改箭头函数属性（词法 this）；`getMulticastEvent` 回调本就是箭头函数，直接改用 this。
- **1 条 no-control-regex**（v4 transport 文件名校验）：拒绝 NUL/换行是刻意的注入防线；规则的"改用 Unicode 转义"提示对控制字符类不豁免，改为定点 `eslint-disable-next-line -- 校验目标就是排除控制字符`（仓库已有 disable-带理由先例）。
- **6 条 unicorn**：3 处 `[...iterable]` 迭代快照改 `Array.from(...)`（保留"派发/采样期间增删不影响本轮"语义并显式标注）；2 处 `...(x ?? {})` 空 fallback 展开删除（undefind 展开本就是 no-op）；1 处 `new Array(n)` 预分配改 `Array.from({length})`。

## 5. Goal→Target 改名收尾（报告点名范围完成）

**方向确认**：事件/命令面已是 Target 词汇（`SessionEventType.TargetChanged`、`target_completion_verification` 字面量），Goal 是遗留类型名。

**已翻转（本期）**：

- `contracts/src/tools/target.ts`：删除 ~36 个 Target* 别名，Goal* 主定义升为 Target\* 正本（`SessionTarget`、`TargetStatus`、`TargetCompletionVerificationOutput`、`TARGET_COMPLETION_VERIFICATION_QUERY_SOURCE`、`formatTargetStateForModel` 等 27 个名字）；删除 14 个零使用旧名。
- `shared/src/validation.ts`：`shucodeTaskGoalStatusSchema/Schema/ChangedPatchSchema` 三对 → Target 正本，删除别名行。
- 23 个消费者文件机械改名（~198 处）；全仓旧名残留 0；15 个 apps 包 + 根 6 个 desktop 工程 typecheck 全绿。
- knip duplicate exports 36 → 11。

**未动（有依据的留档）**：

- `shared/src/shucode-task-types.ts` 的 `ShucodeTaskTarget = ShucodeTaskGoal` 族：`ShucodeTaskTarget` 名字已被 services 的 `shucode-session/shucodeSession.ts` 用作 session 参数基类接口（不同概念同名），强行改名需先做命名决策（如 services 侧改名或引入新名），属独立任务。
- `sendGoalCommand`/`resume_goal_state`/`shucodeSessionGoalSchema` 等：属 live 的 `session/goal` 命令/事件词汇，含 wire 字符串，不在类型别名收敛范围。
- 剩余 11 个 duplicate exports 属其他族（Expert→Workflow 策略别名、recorder 默认导出别名等），非 Goal/Target。

## 验收结果（实测）

1. `pnpm typecheck` 全绿（含 model-option-map/shucode-cua/全部 desktop 工程）；apps 15 个包 tsc 全绿。
2. `pnpm lint`：61 → **0 warnings / 0 errors**。
3. `pnpm architecture:check --changed`：0 违规；`oxfmt`：改动文件全部通过。
4. `pnpm knip`：unlisted dependencies 段落消失；duplicate exports 36 → 11（余者他族）。
5. taskRealtime bus 单测 10/10；`pnpm install` 后 lockfile 正常收敛。
