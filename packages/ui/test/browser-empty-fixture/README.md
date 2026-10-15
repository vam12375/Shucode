Run from the repository root with the Node version declared in `mise.toml`:

```sh
node packages/ui/test/browser-empty-fixture/run-e2e.mjs
```

The runner starts and stops an isolated Vite fixture on port 5193 and launches headless Chromium through the already available `playwright-core`. It never connects to the running desktop app. Set `EMPTY_FIXTURE_BROWSER` to an installed Chrome executable when the Playwright Chromium cache is unavailable. Set `EMPTY_FIXTURE_URL` to test an already running copy of this fixture.

The fixture mounts the real `BrowserEmptyState` (quick sites included) with a ready browser state and records every `onOpenUrl` callback argument. It exercises the two curated groups, zh/en labels, click-through URL expectations from `specs/ui/browser-quick-sites.md`, and narrow-pane truncation. Screenshots are written to `output/playwright/browser-empty/`.

Actual webview navigation (guest queue, dom-ready consumption) reuses the existing `openUrl` path and needs the Electron desktop app; the fixture covers the callback boundary only.
