Run from the repository root with the Node version declared in `mise.toml`:

```sh
node packages/ui/test/conversation-resize-fixture/run-e2e.mjs
```

The runner starts and stops an isolated Vite fixture on port 5191 and launches headless Chromium through the already available `playwright-core`. It never connects to the running desktop app. Set `RESIZE_FIXTURE_BROWSER` to an installed Chrome executable when the Playwright Chromium cache is unavailable. Set `RESIZE_FIXTURE_URL` to test an already running copy of this fixture.

The fixture imports the real toolbar hook, button, menu and production styles. It exercises content/font invalidation, all collapse stages, fast animation reversals, draft/focus/menu preservation, mobile overflow, fallback resize and teardown. Width-only animations must create zero measurement clones after font and render warmup. A newly visited container breakpoint may create one eight-stage measurement profile; revisiting either cached side creates none. These checks measure work amplification independently of machine FPS. Reports and mobile screenshots are written to `output/playwright/conversation-resize/`.

This isolated fixture covers the toolbar. The full conversation timeline, scroll ownership and actual Electron frame/layout costs require the desktop regression run; the message paragraphs here provide browser reflow load without pretending to implement the production virtualizer.
