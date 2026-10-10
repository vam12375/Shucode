# 更新日志

本文件记录 Shucode 的重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

变更内容依据 Git 提交历史与发布 tag 整理。各版本发布日期以对应 tag 打点时间为准。

本仓库为二开版本，版本号从 `0.1.0` 起独立计算：功能级改动递增次版本号，文档、脚本与工程类小改动递增修订号。

版本历程：`v0.1.0`–`v0.10.2` 为同批次导入的连续提交，`v0.11.0` 起为二开定制改动，`v0.12.0` 起为桌面像素厨房视觉重构，`v0.13.0` 起为桌面启动开场动画与后续修复。每个提交对应一个 tag。

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
