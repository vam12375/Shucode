# Desktop 类型检查门禁覆盖

## 背景与问题

报告 P2 指出「`pnpm typecheck` 的 tsc 工程列表未含 `model-option-map`、`shucode-cua`」；同源问题在 desktop 侧更严重：根 `typecheck` 只含 `packages/desktop/tsconfig.host.json`，而 desktop 的 **main / scheduler / preload / renderer** 四个工程从未进入任何门禁。后果：main 工程积压 **84 个类型错误**（23 文件）、preload 2 个、renderer 125 个，全部是长期无人可见的静默漂移。

2026-10-12 修复并接入门禁（本次落地）。desktop 五个窗口/进程工程 + host 全部纳入 `pnpm typecheck`。

## 修复分类（84 main + 2 preload + 125 renderer → 0）

| 类别                         | 代表                                                                                                                                                                                                                                            | 修法                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 跨目录 rootDir 结构          | `src/shared/armsRumShared` 被 main 引用（TS6059/6307）                                                                                                                                                                                          | `tsconfig.main.json` rootDir 提到 `src` + `emitDeclarationOnly`（tsc 只出声明，运行时打包归 tsup，避免逐文件 JS 混进 electron-builder 的 `out/**`）；scheduler 类型经 `tsconfig.scheduler.json` project reference 重定向到声明产物 |
| barrel 漏出类型（TS2305）    | `BrowserViewSurfaceScaleMode`、`WindowControlsOverlayReadyPayload`、`WindowControlsOverlayMetrics`、`DesktopZoomState`（platform.ts 定义但 index.ts 未导出）；`StorageRootSpec`/`IStorageService` import 源错误                                 | shared index.ts 补导出；desktop 侧改 `@shucode/shared` / `@shucode/services` 正确源                                                                                                                                                |
| 判别联合收窄失效             | `browserGuestManager` fork/type/waitFor 三元 + `if(locator)` 收口无法回推 action 类型；`index.ts` 闭包内 `parsed.data.hostId`；`console-message` 旧签名（Electron 41 details-first）；`renderer` 无效的 `"closed"` 比较                         | 逐类显式收窄；闭包先落 const；await 后经函数边界重读生命周期；`HostResponseTypes` 常量非字面量改用 wire 字面量分发                                                                                                                 |
| noUncheckedIndexedAccess     | `appPaths[cursor++]`、`dumps[keptCount-1]`、`POINTER_SCROLL_ALIGNMENTS[i % n]`、dns `LookupAddress` 单复数（`ReturnType<typeof lookup>` 取末位重载）                                                                                            | 显式守卫/本地 const/元组字面量 `as const satisfies`                                                                                                                                                                                |
| 契约错配                     | `ReadAppBoundKeyOptions` 缺 expected\* 字段；`syncAppSettings(patch: unknown)`（已校验却丢类型）；`resolveBrowserViewOwner` null vs undefined；`desktopSaveFile` payload.data 可选性；`desktopTelemetryFetch`/`helpConfig` net.fetch 不接受 URL | 补字段 / `AppSettingsPatch` 推断类型（shared 新增导出）/ 边界归一化                                                                                                                                                                |
| 死代码（类型系统证明不可达） | `desktopRemoteSessions` 的 `case "server"`（RemoteTarget 已退役 server kind）+ 归一化 helper                                                                                                                                                    | 删除                                                                                                                                                                                                                               |
| 页面上下文 DOM               | `browserPlaywrightExecutor` 的序列化函数（`fn.toString()` 在页面执行）引用 `document`/`Element`                                                                                                                                                 | 文件内最小声明（main lib 无 DOM），不全局引入 dom                                                                                                                                                                                  |
| 静默类型逃逸                 | `manifestUpdateProvider` 未校验 YAML→UpdateInfo、`playwright event` 构造、taskRealtime 帧 schema 宽于 core 合约                                                                                                                                 | 显式 `as unknown as` / 出口收口 cast + 注释（对齐 host 侧 bridge 先例）                                                                                                                                                            |
| renderer 全局缺失            | `window.shucode` 无声明（122 errors）；`@shucode/ui/styles.css` side-effect import                                                                                                                                                              | preload 桥对象提取为 `shucodeBridge` + `export type ShucodeBridge = typeof shucodeBridge`；renderer `window-shucode.d.ts` 经 project reference 引此类型（防漂移）；`vite-env.d.ts` 声明 `*.css`                                    |

## 门禁清单（根 package.json typecheck）

`desktop/tsconfig.host.json` + `tsconfig.main.json` + `tsconfig.scheduler.json` + `tsconfig.taskRealtime.json` + `tsconfig.preload.json` + `tsconfig.renderer.json`。

## 契约边界（防回归）

1. desktop 各子工程声明产物：main `emitDeclarationOnly` → `out/main/main/**`、`out/main/shared/**`（.d.ts only）；消费方经 project reference，不跨 rootDir 直接吃源码。
2. renderer 的 `window.shucode` 类型只允许来自 `ShucodeBridge`（preload typeof 推导）；禁止手写镜像声明。
3. 页面上下文函数（serializeRuntimeCall 序列化）的 DOM 声明保持**文件内局部**，不给 main 工程开 dom lib。
4. `out/main` 只允许 tsup 产物（index/entries/chunk-\*）+ tsc 声明（main/、shared/ 子目录）；发现逐文件 JS 说明有工具以错误 rootDir 直跑了 tsc，需清理（历史有过一次：早前误跑 `tsc -b tsconfig.json`）。

## 遗留（明确不在本次范围）

- 已核实：`src/shared/armsRumShared.{js,d.ts,map}` 是 10-09 提交的历史产物，当前全部标准命令（根 typecheck / 各工程 tsc -b / tsup）不再重写它。
- `apps/shucode-cli/packages/adapters` 同样以源码形态直引 `@shucode/model-option-map`（不在根门禁，走 turbo 链）；其增量检查存在同样的跨包漏检陷阱，修法同下方 reference 模式，属 apps 侧独立事项。

## P2 收尾：model-option-map 与 shucode-cua 纳入门禁（2026-10-12）

### 根因机制（实验证实）

报告称两包"在构建图里但类型错误主 typecheck 抓不到"。实测确认并定位到机制：`packages/model-option-map` 的 exports 是 `"." → ./src/index.ts`（源码形态直引），shared 的程序会包含这 8 个跨包 `.ts` 文件；但 **tsc -b 的 up-to-date 快速检查只 stat 项目 `include` 内的文件**——对端源码不在 shared 的 include 里，其改动（内容哈希已记录在 tsbuildinfo）在热缓存后**永不触发重检**。受控实验：向 `model-option-map/src/index.ts` 注入类型错误，热缓存下 `pnpm typecheck` 退出码 0（漏检）；`-p --noEmit` / `-b --force`（冷构建）能抓到。

### 修法（双保险）

1. **self-check（两包都是独立项目）**：`packages/model-option-map` 加入根 typecheck 列表（自身 tsconfig 已 composite，直接可 `-b`）。
2. **声明重定向（消除跨包源码直引）**：`packages/shared/tsconfig.json` 增加 `references: [{ path: "../model-option-map" }]`；TS 把该 import 重定向到其声明产物（dist），跨包源码不再是 shared 程序输入。运行时解析不受影响（vite/tsup 仍按 exports 拿源码）。
3. **shucode-cua self-check**：该占位包（Computer Use 不随此构建发布）没有 TS 源码，唯一接口面是 12 个手写 `.d.ts`；消费者读取时被各自 `skipLibCheck: true` 整体跳过，全链无人校验。新增 `packages/shucode-cua/tsconfig.json`（`skipLibCheck: false` + `noEmit` + `include: ["*.d.ts"]`）把声明本身纳入检查；首次运行声明零错误。

### 探针验证（全部实测通过）

| 探针                                   | 修前                 | 修后                                               |
| -------------------------------------- | -------------------- | -------------------------------------------------- |
| 冷构建注入 `model-option-map` 错误     | 能抓（`-b --force`） | `pnpm typecheck` 退出码 2，定位到 `src/index.ts:6` |
| **热缓存**注入 `model-option-map` 错误 | **漏检（exit 0）**   | 捕获 ✓（原陷阱场景）                               |
| 注入 `shucode-cua/index.d.ts` 未知类型 | 全链不可见           | `pnpm typecheck` 退出码 2，`Cannot find name`      |

## 验收场景（P2 收尾）

1. `pnpm typecheck` 列表含 `packages/model-option-map`、`packages/shucode-cua`；全量零错误。
2. 上述三个探针在热缓存下全部被 `pnpm typecheck` 拦截；还原后归零。
3. `pnpm lint`、`pnpm architecture:check --changed` 与基线一致；改动文件 oxfmt 通过。

## 验收场景（本次已验证）

1. `pnpm typecheck`（含全部 6 个 desktop 工程）零错误。
2. `pnpm lint` 61 警告 / 0 错误与基线一致；`pnpm architecture:check --changed` 0 违规。
3. taskRealtime bus 单测 10/10（重构 coalesce 谓词后行为不变）。
4. `npx tsup` 全 target 构建成功；`out/main` 无 tsc 逐文件 JS 残留。
