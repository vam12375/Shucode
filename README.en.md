# Shucode

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="Shucode" width="128" height="128" />
</div>
<p align="center">
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=47ag983c-8fcb-4d6d-814b-5395193a712c&amp;qr_code=true">Feishu community</a> ·
  <a href="https://discord.gg/z9aBcQXZQ3">Discord</a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

Shucode is an AI coding workspace with desktop and browser interfaces. This repository contains the clients, backend services, shared UI, and Agent runtime source code.

## Updates

- 2026-10-12: This customized build is at Shucode v0.18.10. It continues from the upstream v3.14.3 source with an independent version line starting at `v0.1.0`; see [CHANGELOG.md](CHANGELOG.md) for per-version changes.
- 2026-10-10: This customized build is at Shucode v0.17.5. It continues from the upstream v3.14.3 source with an independent version line starting at `v0.1.0`; see [CHANGELOG.md](CHANGELOG.md) for per-version changes.
- 2026-9-23: Updated to Shucode v3.14.3 upstream.

## Setup

Install Git, Node.js **24.14.0**, and pnpm **10.33.2**. [mise.toml](mise.toml) is the source of truth for tool versions. Run all development and packaging commands below from the repository root.

```bash
pnpm bootstrap
```

`pnpm bootstrap` installs workspace dependencies, prepares local desktop runtime assets, and runs `build:bootstrap`.

The Agent runtime source code lives in [apps/shucode-cli/](apps/shucode-cli/) as a regular directory included when you clone this repository. No separate checkout or Git submodule initialization is required.

Additional setup and build commands:

| Command                        | Purpose                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                 | Install dependencies                                                                                                                |
| `pnpm prepare:desktop-runtime` | Prepare desktop runtime assets, including remote assets by default                                                                  |
| `pnpm prepare:remote-assets`   | Prepare remote runtime assets separately                                                                                            |
| `pnpm bootstrap:with-remote`   | Set up dependencies and local and remote assets, then build the relevant packages sequentially; skip the desktop application bundle |
| `pnpm build`                   | Recursively run each workspace package's build script, including its asset preparation steps                                        |

The default `bootstrap` skips remote asset preparation and is suitable for local desktop development. Run the corresponding preparation command when working with remote workspaces or validating remote distribution assets.

## Development and Usage

### Desktop

```bash
pnpm dev:desktop

# Use the test environment
pnpm dev:desktop:test
```

`pnpm dev:desktop` defaults to `pnpm dev:desktop:prod` and uses production service configuration. The startup script prepares local runtime assets, builds the desktop Agent, then starts Electron and source watchers.

Set `SHUCODE_DATA_BASE_DIR` to use a separate development data directory. For example, on macOS / Linux:

```bash
SHUCODE_DATA_BASE_DIR="$HOME/.shucode-dev-home" pnpm dev:desktop:test
```

### Web Development

Use development mode when editing Web or backend source code:

```bash
pnpm dev:web

# Set the backend workspace (macOS / Linux)
SHUCODE_SERVER_WORKSPACE=/path/to/project pnpm dev:web
```

This starts both the Web development server (default: `http://localhost:5173`) and the backend (default: `http://localhost:3030`). Open the Web development server in your browser. `/ws` and general `/api` requests are proxied to the local backend; `/api/v1/oauth/token` is proxied separately to the configured product service.

When starting the general Web service's HTTP entry directly, configure API/WebSocket authentication with `SHUCODE_SERVER_AUTH_TOKEN`. When creating the service programmatically, use the `authToken` option.

After changing Agent source code, run `pnpm --filter @shucode/cli... build` and restart the service.

### Agent Runtime Source Development

After changing the Agent runtime, build the CLI and its workspace dependencies:

```bash
pnpm --filter @shucode/cli... build
node apps/shucode-cli/packages/cli/dist/shucode.cjs --help
```

Desktop and Web both launch this artifact over stdio (`app-server` mode); restart the corresponding service after rebuilding. The terminal surface (TUI, SEA packaging, and the standalone `shucode` command-line distribution) was removed by product decision; see `specs/cli/terminal-surface-removal.md`.

## Configuration

The root [.env.example](.env.example) provides sample service URLs and build configuration. Copy it to `.env` as needed and place local overrides in `.env.local`. Select the Desktop development environment with `dev:desktop:test` or `dev:desktop:prod`.

| Setting                                | Purpose                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `SHUCODE_DATA_BASE_DIR`                | Base directory for application data, stored under its `.shucode/` subdirectory          |
| `SHUCODE_SERVER_WORKSPACE`             | Workspace path for the Web backend                                                      |
| `SHUCODE_BUILTIN_PROVIDER_CONFIG_FILE` | Path to a local provider configuration file; uses the built-in configuration when unset |

Runtime variables can be set explicitly in the environment of the startup command. See [config/README.md](config/README.md) for the default configuration shipped with the client.

## Packaging

See [third-party/README.md](third-party/README.md) for notice generation, distribution checks, and where the notices are included in each distribution.

### Desktop

```bash
pnpm bundle:desktop

# Set the target platform and CPU architecture
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

The default target is macOS arm64, and the default output directory is `packages/desktop/dist/`. `--os` accepts `mac`, `win`, or `linux`; `--arch` accepts `x64` or `arm64`. Packaging and signing require the tools and configuration for the target platform.

### Remote server (shucode-server)

Remote workspaces connected from the desktop app are served by `packages/shucode-server-cli` (`shucode serve|status|stop|restart|update|uninstall`). Its staging entry is:

```bash
pnpm --filter @shucode/server-cli stage
```

## Repository Structure

| Directory                                            | Responsibility                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/desktop`                                   | Electron Main, Host, Renderer, and desktop packaging                                    |
| `packages/web`                                       | Web client                                                                              |
| `packages/server`                                    | HTTP / WebSocket services and remote connections                                        |
| `packages/shucode-server-cli`                        | Standalone server startup and process management                                        |
| `packages/ui`                                        | Shared React components, hooks, and Zustand state                                       |
| `packages/services`                                  | Business services and persistence                                                       |
| `packages/shared`, `packages/rpc`, `packages/client` | Shared protocols and types, RPC framework, and Agent client SDK                         |
| `packages/provider`, `packages/provider-node`        | Common provider capabilities and Node implementations                                   |
| `apps/shucode-cli`                                   | Agent runtime and CLI entry                                                             |
| `scripts`, `config`, `third-party`                   | Build and maintenance scripts, built-in configuration, and third-party notice materials |

## Project Notice

See [NOTICE.md](NOTICE.md) for feature and promotion scope, maintenance policy, execution and data risks, licensing, and third-party copyright information.
