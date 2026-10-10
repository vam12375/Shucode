# 桌面 UI：启动开场动画

## 产品规则

桌面端每次启动窗口（含冷启动与重开窗口）显示一次开场动画，随后交给应用首屏。动画是纯展示层：不新增偏好、不写持久化、不改变任何启动阶段、不参与启动耗时统计的分段定义。

视觉沿用已获批的像素厨房方向（`specs/ui/desktop-pixel-kitchen.md`）：米纸底 `#f1efdc`、墨 `#17120f`、品牌红 `#c91d1f`；深色系统用深棕 `#211f1b` / `#eee9d7` / `#e9796e`。识别点是**像素组装**：品牌 mark 由 64×64 个像素格从散落状态逐格吸附成形，暖光横扫后字标逐字显形；退场时像素向外炸开消散。

## 所有者与不变量

- 退场条件仍由「动画完成」与「React 首屏 commit」两个既有信号共同决定，任一未满足都不移除启动壳。`packages/desktop/src/renderer/src/main.tsx` 的 `StartupReadyNotifier` 继续通过 `shucode-react-startup-ready` 事件通知，事件名与触发时机不变。
- 更新状态窗口（`windowKind=update-status`）直接跳过启动壳，保持原样；该窗口是透明轻量弹窗，启动 mark 会盖住更新按钮。
- 像素数据由 `packages/desktop/scripts/build-splash-mark.mjs` 从 `packages/ui/src/assets/shucode-logo.png` 生成并写入 `index.html`，标记为 `splash-mark-data`。禁止手写该数据；`--check` 用于校验一致性。
- 动画不依赖 UI 包 CSS，启动壳必须在 `styles.css` 加载前独立成立，因此颜色与字体在 `index.html` 内联声明。

```text
index.html 内联脚本（动画所有者）
  ├─ 像素数据解析 → canvas 逐格绘制 → 组装 / 暖光 / 退场
  └─ 退场门闩：animationDone ∧ reactReady
        ├─ animationDone：rAF 到达停帧时刻，或 HOLD 兜底定时器
        └─ reactReady：shucode-react-startup-ready（main.tsx 首次 commit，含 3000ms 兜底）
```

## 时间轴

| 区间 (ms) | 内容 |
| --------- | ---- |
| 0–720 | 像素径向波次吸附组装，带落下过冲与落点挤压 |
| 760–1180 | 组装完成，一道暖光沿对角线横扫 |
| 660–1260 | 字标逐字旋起，红色光标与进度格点亮 |
| 退场 | 像素径向炸开消散（420ms），整壳前推、提亮并淡出 |

单格落下 `FALL_MS = 380`，径向延迟上限 `STAGGER_MS = 260`，随机抖动 `JITTER_MS = 80`。

## 降级与边界

- `prefers-reduced-motion: reduce`：不启动 rAF，mark 直接绘制组装终态；文字节点取消全部延迟与位移动画，光标保留静态闪烁。
- 像素数据缺失或解析失败：跳过动画，直接按「动画完成」推进，启动壳仍会正常退场，不会卡在遮罩。
- 窗口被遮挡导致 rAF 长时间不调度：`HOLD_MS + 400ms` 定时器兜底标记动画完成。
- canvas 后备缓冲为格子数的整数倍（64 × 3 = 192），显示尺寸与后备缓冲 1:1 并通过 `image-rendering: pixelated` 保持硬边；非整数倍会让像素边缘发虚。
- 字标为纯展示字符节点，完整名称由 `.splash-sr` 提供，辅助技术立即可读。

## 验收

1. 真实 Electron 启动：像素组装、暖光、字标依次出现，退场时像素炸开且不闪白；重开窗口再次显示一次。
2. `packages/desktop/scripts/build-splash-mark.mjs --check` 通过，即 `index.html` 内联数据与品牌资产一致。
3. 浅/深系统主题、`prefers-reduced-motion`、1024×768 与 1440×900 下无裁切、无横向溢出。
4. 更新状态窗口不出现启动壳。
5. 像素数据整体删除后，启动流程仍能正常进入应用（仅无动画）。

预览与逐帧核对记录在 `output/splash-preview/`（冻结时钟看 canvas 中间帧，真实时间看 CSS 驱动的终态）。
