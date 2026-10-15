import { createRoot } from "react-dom/client";
import { ShucodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import { applyTheme } from "../../src/useTheme.js";
import { CanvasWorkspace } from "../../src/canvas/CanvasWorkspace.js";
import { ConfirmDialogHost } from "../../src/ConfirmDialog.js";
import "../../src/styles.css";

const query = new URLSearchParams(location.search);
applyTheme(query.get("theme") === "dark" ? "zai-dark" : "zai-light");
document.documentElement.setAttribute("data-shucode-browser-theme", "light");

function Fixture() {
  // scope 让每个 e2e 用例拿到独立的 localStorage 画布域，避免用例间串数据。
  const scopeId = query.get("scope") ?? "default";
  return (
    <main className="flex h-screen w-screen flex-col bg-background">
      <CanvasWorkspace workspacePath={`/tmp/canvas-fixture-${scopeId}`} />
      <ConfirmDialogHost />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <ShucodeIntlProvider initialLocale={query.get("locale") === "en" ? "en-US" : "zh-CN"}>
    <Fixture />
  </ShucodeIntlProvider>,
);
