# 更新日志

本文件记录 Shucode 的重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

变更内容依据 Git 提交历史与发布 tag 整理。各版本发布日期以对应 tag 打点时间为准。

本仓库为二开版本，版本号从 `0.1.0` 起独立计算：功能级改动递增次版本号，文档、脚本与工程类小改动递增修订号。

版本历程：`v0.1.0`–`v0.10.2` 为同批次导入的连续提交，`v0.11.0` 起为二开定制改动，`v0.12.0` 起为桌面像素厨房视觉重构，`v0.13.0` 起为桌面启动开场动画与后续修复，`v0.14.0` 起为设置页模型发现与启动动画改版，`v0.16.0` 起为用量统计仪表盘，`v0.17.0` 起为开场动画开关与子智能体状态色，`v0.18.0` 起为完全访问确认、协议架构治理与实时协调器进程下沉。每个提交对应一个 tag。

## [0.18.10] - 2026-10-12

### 变更

- 版本号更新为 `0.18.10`；README 与英文 README 的更新说明同步到当前版本。

## [0.18.9] - 2026-10-12

### 文档

- 收录《代码优化分析报告-2026-10-12.md》（全仓四路审计与 file:line 证据）与 P2 清理批次记录 `specs/cleanup/p2-cleanup-batch.md`。

## [0.18.8] - 2026-10-12

### 修复

- 清除全仓 61 条 lint 警告（unused 导入/变量/参数、unsafe-finally、this 别名、控制字符正则与 unicorn 规则），其中 `tasksDatabase/startup.ts` 两处 finally 守卫式 throw 重构为显式收尾语义（首因优先不变），无新增豁免。

## [0.18.7] - 2026-10-12

### 修复

- 桌面端设置同步 IPC 的载荷契约改收校验后的 `AppSettingsPatch` 具体类型，不再以 `unknown` 让下游重复收窄。

## [0.18.6] - 2026-10-12

### 变更

- 完成 Goal→Target 类型词汇收尾：`contracts/tools/target.ts` 的 27 个 Target\* 名字升为正本、删除 36 个别名与 14 个零使用旧名，core/adapters/bootstrap 共 22 个文件跟随改名，旧名全仓零残留。

## [0.18.5] - 2026-10-12

### 变更

- services 日志统一到 `createServiceLogger`：oauthService、settingService、zaiProviderAdapter、mcpSyncService、shucodeAgentService 五处 console 直连日志迁入统一诊断通道。

## [0.18.4] - 2026-10-12

### 变更

- 依赖清单整理：补齐 8 处 unlisted dependencies（zod、builder-util-runtime、vite、lucide-react、yaml、yazl、@modelcontextprotocol/sdk）；ui 包移除 11 个经逐项验证的零引用依赖（含 `@stripe/*`、`marked`、`media-chrome` 等）。

## [0.18.3] - 2026-10-12

### 修复

- 修复 desktop 主进程与 preload/renderer 的全部类型错误（211 处，含 Electron 41 `console-message` 新签名），main/scheduler/taskRealtime/preload/renderer 纳入根 typecheck 门禁；`window.shucode` 类型改由 preload 桥对象 `typeof` 派生，防止镜像声明漂移。

## [0.18.2] - 2026-10-12

### 变更

- task realtime 协调器下沉为独立 UtilityProcess：租约仲裁、流攒批与回放缓冲、会话消息路由移出 Main 进程，Main 只保留按 hostId 的无状态帧转发；新增 Main↔协调器帧协议、崩溃自动重启（60 秒 5 次熔断）与该子系统首批 10 条单测。

## [0.18.1] - 2026-10-12

### 变更

- 打破协议双栈目录级依赖环：v4 目录对旧栈的 3 处反向 import 清零（model-execution 迁入 v4、residency lease 拆分），旧栈退役在结构上可行；同时退役 5 个全仓零调用的旧协议方法（session/fork、session/stop、session/cancelBackgroundTask、session/usage、usage/stats）与专属 schema。

## [0.18.0] - 2026-10-12

### 新增

- 输入框模式菜单选择「完全访问」时新增确认弹窗：列出授予的能力与风险，确认后才切换模式，菜单点选与快捷键循环两条路径统一拦截。

## [0.17.5] - 2026-10-10

### 变更

- 版本号更新为 `0.17.5`；README 与英文 README 的更新说明同步到当前版本，并注明二开版本线自 `v0.1.0` 起独立计算、逐版本变更见本文件。

## [0.17.4] - 2026-10-10

### 修复

- 消除对话面板缩放中的重复同步排版：工具栏改为复用八个收缩档位的宽度缓存，时间线按 ResizeObserver entry 记录当前与稳定宽度、同一 864px 断点内不逐像素更新分页资格；浏览器 E2E 显示宽度动画期间测量克隆与探针均为 0。

## [0.17.3] - 2026-10-10

### 变更

- 新增对话面板宽度变化的性能契约 `specs/ui/conversation-panel-resize-performance.md`，记录所有权、失效边界与验收。

## [0.17.2] - 2026-10-10

### 变更

- 版本号更新为 `0.17.2`，记录用量统计仪表盘、开场动画开关与子智能体状态色的版本区间。

## [0.17.1] - 2026-10-10

### 新增

- 子智能体工具卡按语义色区分状态：运行中（琥珀 + 旋转指示）、已完成（绿）、失败（红 + 既有错误 tooltip）、其它（中性），状态词与指示物双通道表达；其它工具卡外观不变。

## [0.17.0] - 2026-10-10

### 新增

- 设置页「常规」新增启动开场动画开关（`startupAnimationEnabled`，缺省开启）：关闭后跳过逐帧动画，但仍保留纯色品牌底到 React 就绪，避免首帧空白闪烁；只影响后续新建窗口，不打断正在播放的动画。

## [0.16.4] - 2026-10-10

### 新增

- 使用统计设置页升级为仪表盘：Shucode / 所有客户端范围切换、自定义日期与时间范围、趋势与 53 周热图、供应商与模型汇总、请求日志有界分页，以及模型定价管理与 models.dev 导入。

## [0.16.3] - 2026-10-10

### 变更

- 桌面端用量统计改由目标 Environment 的 Host 提供：远端 workspace 不再回落到本机用量库，旧远程契约同步纳入 `usageStatsService`。

## [0.16.2] - 2026-10-10

### 新增

- 外部客户端用量采集：只读扫描 Codex、Claude Code、Pi、Gemini、OpenCode 与 DSH Desktop 日志，增量派生本机 SQLite 账本，并与 Shucode 用量联邦合并；单源失败不影响其它来源。
- 模型定价管理：支持 CC Switch 与 models.dev 导入同步、手工编辑与整数金额累加，未知单价显示未计价。

## [0.16.1] - 2026-10-10

### 新增

- CLI 新增持久化用量账本（迁移 `0023-durable-usage`）与统计查询仓储，取消隐式 30 天清理，并补上用量统计与定价协议接口。

## [0.16.0] - 2026-10-10

### 新增

- 共享协议新增用量时间桶、Token 与缓存口径、模型计价、仪表盘快照与有界分页游标类型，`AppSettings` 新增 `usagePricing`。

## [0.15.4] - 2026-10-10

### 变更

- 新增用量统计与模型定价规格 `specs/usage/dashboard.md`，确定 CLI usage store 为唯一事实源、外部客户端只读采集与联邦分页边界。

## [0.15.3] - 2026-10-10

### 变更

- 版本号更新为 `0.15.3`，记录设置页模型发现与启动动画改版的版本区间。

## [0.15.2] - 2026-10-10

### 变更

- 仓库忽略规则新增 `specs/`：规格文档作为本地工作记录维护，新增文件不入库；已跟踪的三份规格保持跟踪，其修改不受影响。

## [0.15.1] - 2026-10-10

### 修复

- 设置导航隐藏滚动条槽位（保留滚轮与键盘滚动路径）；复合输入内的 API Key 显示按钮补上 `translate: none`，不再上移半个自身高度。

## [0.15.0] - 2026-10-10

### 变更

- 桌面启动开场动画改版为约 7 秒「像素超频」：引信、Chef 点阵集结、SHU / CODE 切割与定格；画布覆盖完整窗口，标题栏安全区只约束角标与自绘窗控；像素数据改由 `chef.png` 生成并保持 `--check` 校验。
- 新增 `packages/desktop/scripts/check-startup-splash.mjs` 真实 Chromium 回归校验；`main.tsx` 两条首屏路径挂载启动期自绘窗控。

## [0.14.4] - 2026-10-10

### 新增

- 启动壳覆盖期间 Windows/Linux 仍可用窗口控件：`DesktopStartupWindowControls` 通过 portal 复用既有 `DesktopWindowControls`，壳移除时自动卸载。

## [0.14.3] - 2026-10-10

### 新增

- 模型设置页支持「获取模型列表」：一次拉取供应商模型，搜索、全选后串行批量导入；拉取结果只由卡片局部状态拥有，关闭即丢弃。
- 供应商卡片名称改为就地编辑的铅笔按钮，删除改为垃圾桶按钮并保留二次确认，移除 `...` 菜单。

## [0.14.2] - 2026-10-10

### 新增

- 业务服务透出 Provider 模型列表能力（Provider 设置服务与 Agent 服务），沿用既有连接解析与鉴权路径。

## [0.14.1] - 2026-10-10

### 新增

- CLI bootstrap 实现 `provider/listModels`：候选端点派生、按 API 格式选择鉴权头、响应解析与失败分类，并新增 24 项测试（含真实本地 HTTP 请求）。

## [0.14.0] - 2026-10-10

### 新增

- 共享协议新增 `provider/listModels` 参数与结果 schema 及 `ProviderModelListingResult` 类型；失败按常规结果返回，便于设置页给出可操作提示。

## [0.13.6] - 2026-10-10

### 变更

- 启动动画规格改写为「像素超频」方案：记录 7 秒时间轴、内联脚本唯一所有权、标题栏安全区与窗控边界、降级清理路径与真实浏览器 E2E 验收。

## [0.13.5] - 2026-10-10

### 变更

- 像素厨房规格补充供应商卡片交互入口、设置导航滚动条与复合输入附加按钮的规则及验收。

## [0.13.4] - 2026-10-10

### 变更

- 版本号更新为 `0.13.4`，记录桌面启动开场动画与两处修复的版本区间。

## [0.13.3] - 2026-10-10

### 修复

- 欢迎页卡片在入口与 API key 表单之间切换时不再重播 850ms 入场延迟：入场结束改由 `LoginPanel` 持有的已交互展示态决定，不再依赖会随按钮卸载失效的 `:focus-within`。

## [0.13.2] - 2026-10-10

### 修复

- 恢复 `@shucode/shared` 的 `ESTIMATED_TOKEN_CHAR_DIVISOR` 出口（上一轮套餐清理误删），CLI core 的上下文、手动压缩与压缩后提醒估算恢复可编译。

## [0.13.1] - 2026-10-10

### 变更

- 新增 CLI 字符数 token 估算契约 `specs/cli/token-estimation.md`，约定常量所有者、公共入口与「不用于计费」边界。

## [0.13.0] - 2026-10-10

### 新增

- 桌面启动开场动画：`packages/desktop/src/renderer/index.html` 内联像素组装动画与启动壳；`packages/desktop/scripts/build-splash-mark.mjs` 从品牌资产生成 64×64 像素数据并支持 `--check` 校验；更新状态窗口跳过启动壳，减少动态效果或像素数据缺失时直接进入终态。

## [0.12.4] - 2026-10-10

### 变更

- 新增启动开场动画规格 `specs/ui/desktop-startup-splash.md`，记录退场门闩、时间轴与降级边界。

## [0.12.3] - 2026-10-09

### 变更

- 版本号更新为 `0.12.3`，记录桌面像素厨房视觉重构的版本区间。

## [0.12.2] - 2026-10-09

### 变更

- 仓库忽略规则新增 `.playwright-cli/` 与 `output/`，本地调试与命令输出产物不入库。

## [0.12.1] - 2026-10-09

### 变更

- 共享 UI 层应用像素厨房视觉：欢迎页补齐标题逐字渐现、厨师 Logo 动画与「选择开工方式」入口；侧栏、工作区外壳、会话与工具卡、文件/Diff/终端/浏览器面板、设置与连接弹窗增加 `pk-*` 样式挂点；补充入口中英文文案。交互、状态所有者、键盘行为与 test id 保持不变。

## [0.12.0] - 2026-10-09

### 新增

- 桌面端像素厨房主题资源与样式（`packages/ui/src/assets/pixel-kitchen/`、`desktop-pixel-kitchen.css`、`pixel-kitchen-catalog.css`、`pixel-kitchen-settings.css`、`pixel-kitchen-workspace.css`）：入库本地像素字体、品牌图与上游许可，按桌面平台根标记投影，Web 与手机远控不受影响。

## [0.11.6] - 2026-10-09

### 变更

- 新增桌面视觉重构规格 `specs/ui/desktop-pixel-kitchen.md`，并在 `DESIGN.md` 记录 Desktop pixel kitchen 的语义 token、圆角与字体使用边界。

## [0.11.5] - 2026-10-09

### 变更

- 版本号更新为 `0.11.5`，记录移除官方订阅套餐与用量统计链路的版本区间。

## [0.11.4] - 2026-10-09

### 移除

- 共享 UI 层（`packages/ui`）：删除套餐升级弹窗与内嵌购买页、额度重置组件、侧栏套餐徽标与用量摘要、Start Plan 卡片与套餐用量图表，并清理中英文套餐文案；设置页只保留自定义 Provider 与本地用量统计。

## [0.11.3] - 2026-10-09

### 移除

- 桌面端（`packages/desktop`）：远程 workspace Host 不再注册套餐凭据服务、账号请求鉴权服务与团队套餐 API key 解析。

## [0.11.2] - 2026-10-09

### 变更

- 内置 Provider 配置（`config/provider/shucode-builtin.json`）：移除套餐账号节点，只保留自定义 Provider 所需配置。
- `packages/provider-node`：新增套餐账号退役名单，解码远端 Release 时直接拒绝，避免旧缓存把无实现支撑的账号入口带回注册表。

## [0.11.1] - 2026-10-09

### 移除

- 业务服务（`packages/services`）：删除套餐权益、Z.ai 套餐订阅、账号额度与用量监控实现；套餐通道只保留闲时任务与动态工作流灰度配置。

## [0.11.0] - 2026-10-09

### 移除

- 共享类型（`packages/shared`）：删除套餐订阅、额度重置、套餐身份与 Coding Plan 额度类型模块。

### 变更

- `ForceUpdateConfig` 迁入 `forceUpdate.ts`，强制升级门禁不受套餐类型下线影响。
- 二开定制：客户端只保留「自定义（personal）Provider + API key」，闲时任务与动态工作流灰度配置保留。

## [0.10.2] - 2026-10-09

### 变更

- 版本号改由本仓库独立维护：根 `package.json` 由上游 `3.14.3` 重置为 `0.10.2`，桌面端 `SHUCODE_VERSION`、分发脚本、更新检查与运行资源路径随之使用新版本号。

## [0.10.1] - 2026-10-09

### 新增

- 仓库 AI 技能与协作约定（`.agents/skills/`）：架构治理、提交规范、功能边界规划、依赖引用与前端实现流程说明。

## [0.10.0] - 2026-10-09

### 新增

- Agent CLI 与运行时（`apps/shucode-cli`）：CLI 入口、core runtime、adapters、TUI、内置插件与技能、SEA 打包脚本。

## [0.9.0] - 2026-10-09

### 新增

- 桌面应用（`packages/desktop`）：Electron main/host/renderer/preload、定时任务调度、原生辅助源码与打包构建配置。
- CUA 能力（`packages/shucode-cua`）：broker、pip 会话、端口与权限契约及宿主显示契约。

## [0.8.0] - 2026-10-09

### 新增

- Web 服务端（`packages/server`）：HTTP 与 stdio 服务入口、Host 能力声明、远程部署后端与握手。
- server CLI（`packages/shucode-server-cli`）：进程守护、IPC、发行包下载安装、锁与平台适配。

## [0.7.0] - 2026-10-09

### 新增

- Web 客户端（`packages/web`）：入口装配、浏览器 OAuth 回调、会话分享落地页与站点资源。
- 形式化验证可视化应用（`packages/formal-proof`）。

## [0.6.0] - 2026-10-09

### 新增

- 共享 UI 层（`packages/ui`）：基础组件与弹窗宿主、Zustand store、hooks、消息与会话渲染、工作区/终端/Git 面板、设置与登录界面、中英文语言资源。

## [0.5.0] - 2026-10-09

### 新增

- 业务服务（`packages/services`）：会话与 Agent 运行时编排、命令 admission、运行时工具与终端、凭证与登录、本地存储与跨端同步、远程链路与服务日志。

## [0.4.0] - 2026-10-09

### 新增

- 模型接入层（`packages/provider`、`packages/provider-node`）：Provider 注册与来源解析、账号态 Provider、配置覆盖与 Node 侧持久化、内置 Provider 配置同步。
- 模型选项映射（`packages/model-option-map`）：选项映射的解析、编译与求值。

## [0.3.0] - 2026-10-09

### 新增

- RPC 框架（`packages/rpc`）：请求协议与序列化、通道生命周期、IPC 与远程接入、日志与网络遥测中间件。
- 客户端 SDK（`packages/client`）：WebSocket、MessagePort 与远程服务访问入口。

## [0.2.0] - 2026-10-09

### 新增

- 共享协议与类型（`packages/shared`）：stdio Agent 协议与运行时校验、平台服务接口、workspace identity、任务与会话共享类型、版本信息出口。

## [0.1.3] - 2026-10-09

### 变更

- 仓库脚本（`scripts/`）：构建与资源准备、原生搜索工具打包与校验、发行组装与安装器、架构边界检查、第三方许可生成、`release-it` 变更日志写入器。
- 远程 harness（`harness/remote/`）：Dockerfile、构建脚本与说明。

## [0.1.2] - 2026-10-09

### 变更

- 第三方资产与声明（`third-party/`、`patches/`）：依赖版本与覆盖清单、内嵌组件清单、上游许可原文与来源记录、pnpm patch 补丁。
- 原生搜索依赖归档（`apps/shucode-cli/dependencies/`）：随仓库分发的归档、`SHA256SUMS` 与说明。

## [0.1.1] - 2026-10-09

### 变更

- 仓库文档：`README.md`、`README.en.md`、`AGENTS.md`、`CONTEXT.md`、`DESIGN.md`、`NOTICE.md`、`THIRD-PARTY-NOTICES.md` 与 `LICENSE`。
- 品牌资源（`public/logo/`）：应用图标与 README 使用的资源。

## [0.1.0] - 2026-10-09

### 新增

- 单仓工程基线：pnpm workspace 与锁定依赖、TypeScript project references、oxlint/oxfmt/Knip 配置、架构策略与基线、`release-it` 发布配置、内置 Provider 与默认配置、环境变量示例。
