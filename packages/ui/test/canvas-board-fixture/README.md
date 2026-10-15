# canvas-board-fixture

无限画布（`CanvasBoard`）的交互 E2E fixture，模式与 `browser-empty-fixture` 一致：自起 Vite（端口 5194）+ playwright-core 自起 headless Chromium，浏览器外置可用 `CANVAS_FIXTURE_URL` / `CANVAS_FIXTURE_BROWSER` 覆盖。

```sh
node packages/ui/test/canvas-board-fixture/run-e2e.mjs
```

覆盖场景：工具栏添加便签、文本编辑落盘、reload 恢复、双击空白创建、拖拽连线持久化、删除节点级联清边、en 词条。

截图输出 `output/playwright/canvas-board/`。
