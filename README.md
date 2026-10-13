# Shucode

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="Shucode" width="128" height="128" />
</div>
<p align="center">
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=47ag983c-8fcb-4d6d-814b-5395193a712c&amp;qr_code=true">飞书社群</a> ·
  <a href="https://discord.gg/z9aBcQXZQ3">Discord</a>
</p>
<p align="center">
  简体中文 | <a href="README.en.md">English</a>
</p>

Shucode 是 AI 编程工作台，提供桌面应用和浏览器界面。本仓库包含客户端、后端服务、共享 UI，以及 Agent 运行时源码。

## 更新

- 2026-10-12：二开版本线更新至 Shucode v0.18.10。本仓库在上游 v3.14.3 源码基础上二开，版本号自 `v0.1.0` 独立起算，逐版本变更见 [CHANGELOG.md](CHANGELOG.md)。
- 2026-10-10：二开版本线更新至 Shucode v0.17.5。本仓库在上游 v3.14.3 源码基础上二开，版本号自 `v0.1.0` 独立起算，逐版本变更见 [CHANGELOG.md](CHANGELOG.md)。
- 2026-9-23：上游更新至 Shucode v3.14.3 版本。

## 初始化

准备 Git、Node.js **24.14.0** 和 pnpm **10.33.2**，版本以 [mise.toml](mise.toml) 为准。以下开发和打包命令均在仓库根目录执行。

```bash
pnpm bootstrap
```

`pnpm bootstrap` 安装 workspace 依赖、准备桌面本地运行资源，再执行 `build:bootstrap`。

Agent 运行时源码位于 [apps/shucode-cli/](apps/shucode-cli/)，作为普通目录随本仓库一起克隆，无需单独拉取或初始化 Git submodule。

根据需要选择其他初始化或构建入口：

| 命令                           | 用途                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `pnpm install`                 | 安装依赖                                                          |
| `pnpm prepare:desktop-runtime` | 准备桌面运行资源，默认包含远程资源准备                            |
| `pnpm prepare:remote-assets`   | 单独准备远程运行资源                                              |
| `pnpm bootstrap:with-remote`   | 初始化依赖、本地与远程资源，并串行构建相关包；跳过桌面应用 bundle |
| `pnpm build`                   | 递归执行各 workspace 包的构建脚本，包括包内的资源准备步骤         |

默认 `bootstrap` 跳过远程资源准备，适合本地桌面开发。使用远程工作区或验证远程发行资源时，再运行对应准备命令。

## 开发与运行

### 桌面版

```bash
pnpm dev:desktop

# 使用测试环境
pnpm dev:desktop:test
```

`pnpm dev:desktop` 默认等同于 `pnpm dev:desktop:prod`，使用生产服务配置。启动脚本会准备本地运行资源、构建桌面 Agent，再启动 Electron 和源码监听。

需要独立开发数据目录时，可设置 `SHUCODE_DATA_BASE_DIR`。例如在 macOS / Linux 中：

```bash
SHUCODE_DATA_BASE_DIR="$HOME/.shucode-dev-home" pnpm dev:desktop:test
```

### 远程功能（SSH/WSL）

先执行 `pnpm bootstrap:with-remote` 准备远程资源（mock-cdn），再 `pnpm dev:desktop`；连接远程项目时资源选择「本地下载后上传」。开发态资源取自本地 `packages/desktop/mock-cdn` 和本地构建产物，经 SFTP 上传到远程，不访问 CDN。

### Web 开发

修改 Web 或后端源码时，使用开发模式：

```bash
pnpm dev:web

# 指定后端工作区（macOS / Linux）
SHUCODE_SERVER_WORKSPACE=/path/to/project pnpm dev:web
```

该命令同时启动 Web 开发服务器（默认 `http://localhost:5173`）和后端（默认 `http://localhost:3030`）；浏览器访问前者。`/ws` 和一般 `/api` 请求代理到本地后端，`/api/v1/oauth/token` 单独代理到当前配置的产品服务。

直接启动通用 Web 服务的 HTTP 入口时，通过 `SHUCODE_SERVER_AUTH_TOKEN` 配置 API／WebSocket 认证；通过程序接口创建服务时，使用 `authToken` 选项。

Agent 源码修改后，执行 `pnpm --filter @shucode/cli... build` 并重启服务。

### Agent 运行时源码开发

修改 Agent 运行时后，构建 CLI 及其 workspace 依赖：

```bash
pnpm --filter @shucode/cli... build
node apps/shucode-cli/packages/cli/dist/shucode.cjs --help
```

桌面端与网页端都以 stdio 启动该产物（`app-server` 模式），修改后重启对应服务即可。终端形态（TUI、SEA 打包与独立 `shucode` 命令行发行包）已按产品决策下线，见 `specs/cli/terminal-surface-removal.md`。

## 配置

根目录 [.env.example](.env.example) 提供服务地址与构建配置示例，可按需复制到 `.env`，本地覆盖放入 `.env.local`。Desktop 的开发环境通过 `dev:desktop:test` / `dev:desktop:prod` 选择。

| 配置                                   | 用途                                             |
| -------------------------------------- | ------------------------------------------------ |
| `SHUCODE_DATA_BASE_DIR`                | 应用数据基目录，数据写入其下的 `.shucode/`       |
| `SHUCODE_SERVER_WORKSPACE`             | Web 后端的工作区路径                             |
| `SHUCODE_BUILTIN_PROVIDER_CONFIG_FILE` | 本地 Provider 配置文件路径；未设置时使用内置配置 |

运行时变量可在启动命令的环境中显式设置。随客户端发布的默认配置见 [config/README.md](config/README.md)。

## 打包

第三方声明生成、发行校验流程及声明在发行物中的位置见 [third-party/README.md](third-party/README.md)。

### 桌面版

```bash
pnpm bundle:desktop

# 指定目标平台与 CPU 架构
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

默认目标为 macOS arm64，默认输出目录为 `packages/desktop/dist/`。`--os` 支持 `mac`、`win`、`linux`，`--arch` 支持 `x64`、`arm64`；实际打包与签名需要目标平台对应的工具和配置。

安装：双击打开产物 DMG，将 Shucode 拖入"应用程序"。本地构建未签名，首次打开若被 macOS 拦截，执行：

```bash
sudo xattr -rd com.apple.quarantine /Applications/Shucode.app
```

### 远程服务（shucode-server）

桌面端连接的远程工作区由 `packages/shucode-server-cli` 发行（`shucode serve|status|stop|restart|update|uninstall`），其 staging 入口为：

```bash
pnpm --filter @shucode/server-cli stage
```

## 仓库结构

| 目录                                                 | 职责                                       |
| ---------------------------------------------------- | ------------------------------------------ |
| `packages/desktop`                                   | Electron Main、Host、Renderer 与桌面打包   |
| `packages/web`                                       | Web 客户端                                 |
| `packages/server`                                    | HTTP / WebSocket 服务与远程连接            |
| `packages/shucode-server-cli`                        | 独立 Server 启动与进程管理                 |
| `packages/ui`                                        | 共享 React 组件、hooks 与 Zustand 状态     |
| `packages/services`                                  | 业务服务与持久化                           |
| `packages/shared`、`packages/rpc`、`packages/client` | 共享协议和类型、RPC 框架、Agent 客户端 SDK |
| `packages/provider`、`packages/provider-node`        | Provider 公共能力与 Node 实现              |
| `apps/shucode-cli`                                   | Agent 运行时与 CLI 入口                    |
| `scripts`、`config`、`third-party`                   | 构建维护脚本、内置配置与第三方声明材料     |

## 项目声明

功能与优惠范围、维护规则、执行与数据风险，以及许可和第三方版权说明，详见 [NOTICE.md](NOTICE.md)。
