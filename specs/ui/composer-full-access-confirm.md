# Composer 切换到完全访问前的确认弹窗

## 目标与范围

Composer 的权限模式下拉菜单（计划模式 / 变更前确认 / 自动编辑 / 完全访问）中，选择「完全访问」(yolo) 时直接更新草稿模式，没有风险告知。参照 Codex 的交互，在选择进入完全访问前弹出确认对话框，列出授予的能力与风险，用户确认后才切换。

仅作用于 Composer 模式菜单与模式循环快捷键两条进入 yolo 的路径。不改变模式的草稿语义（模式仍属于下一次 submission，见 `SessionPane.handleSwitchMode`），不改变权限请求弹窗（`PermissionDialog`）与设置页的权限选择。

## 产品规则

- 任何从非 yolo 模式进入 yolo 的切换（菜单点选、快捷键循环）都必须先弹出确认框；已在 yolo 时不重复弹出。
- 确认框取消或按 Esc 关闭时，草稿模式保持不变，菜单关闭。
- 确认后才调用既有 `onSwitchMode("yolo")`，不新增第二条模式写入路径。
- 计划模式的勾选切换、其它三种模式之间的切换不受影响。
- 确认框每次进入 yolo 都出现（Codex 同款行为），不做「不再询问」记忆。

## 状态所有者与数据流

```
用户选择 yolo（菜单 onValueChange / cycle 快捷键）
  └─ V4ComposerModeSwitch: pendingYoloConfirm = true（局部 UI 状态，唯一所有者）
       └─ 关闭模式下拉（onConfigPickerOpenChange("mode", false)）
       └─ AlertDialog 打开
            ├─ 取消 / Esc / 点遮罩 → pendingYoloConfirm = false，草稿模式不变
            └─ 确认 → pendingYoloConfirm = false → onSwitchMode("yolo")（既有唯一路径）
```

- `pendingYoloConfirm` 是纯 Composer 局部状态，不进 Zustand store、不持久化、不同步。
- `onSwitchMode` 仍是模式变更的唯一入口，弹窗只是门卫（gate），不持有模式状态。

## 接口与落点

- `packages/ui/src/v4/composer/V4ComposerModeControls.tsx`：新增 `pendingYoloConfirm` 状态、`requestModeSwitch` 门卫函数与确认弹窗 JSX。
- `packages/ui/src/i18n/locales/zh-CN.ts`、`en-US.ts`：新增 `mode.confirm.yolo.*` 文案。
- 复用 `@/components/ui/alert-dialog.js`；弹窗壳 `rounded-2xl`，内部能力分组 `rounded-xl`（DESIGN.md Dialogs 规则）。

## 验收场景

1. 当前为「变更前确认」，点开模式菜单选「完全访问」→ 菜单关闭，出现确认框；点「确认」→ 触发按钮显示「完全访问」；点「取消」→ 模式不变。
2. 快捷键循环模式从「自动编辑」循环到「完全访问」→ 同样弹出确认框；确认后才切换。
3. 当前已是「完全访问」，再次打开菜单点「完全访问」→ 不弹确认框（radio 已选中不触发 onValueChange）。
4. 确认框打开时按 Esc 或点击取消 → 草稿模式保持原值，可重新打开菜单。
