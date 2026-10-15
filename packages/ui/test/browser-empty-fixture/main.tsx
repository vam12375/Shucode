import { createRoot } from "react-dom/client";
import { ShucodeIntlProvider, useShucodeIntl } from "../../src/i18n/IntlProvider.js";
import { applyTheme } from "../../src/useTheme.js";
import { BrowserEmptyState } from "../../src/EmbeddedBrowserPaneParts.js";
import { INITIAL_BROWSER_STATE, type BrowserState } from "../../src/embeddedBrowserHelpers.js";
import "../../src/styles.css";

const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle(
  "platform-mac-desktop",
  query.get("platform") === "desktop",
);
document.documentElement.setAttribute("data-shucode-browser-theme", "light");
applyTheme(query.get("theme") === "dark" ? "zai-dark" : "zai-light");
localStorage.setItem("shucode-theme", query.get("theme") === "dark" ? "zai-dark" : "zai-light");

const openedUrls: string[] = [];
(window as Window & { browserEmptyFixture?: { openedUrls: string[] } }).browserEmptyFixture = {
  openedUrls,
};

// 空状态在真实面板首次出现时 guest 已渲染完成（未挂载时不显示转圈）；fixture 固定为就绪。
const browserState: BrowserState = {
  ...INITIAL_BROWSER_STATE,
  isReady: true,
};

function Fixture() {
  const { intl } = useShucodeIntl();
  return (
    <main className="flex h-screen w-screen items-center justify-center bg-background-alt p-8">
      {/* styles.css 的 Tailwind 探测范围限定在 src/**，fixture 里不能新造任意值类；
          面板尺寸用内联样式模拟侧栏，其余视觉类复用 src 已扫描的工具类。 */}
      <div
        className="relative overflow-hidden rounded-xl border border-border bg-background"
        style={{ width: "min(560px, 100%)", height: 720 }}
      >
        <BrowserEmptyState
          browserState={browserState}
          formatMessage={intl.formatMessage}
          onOpenUrl={(url) => {
            openedUrls.push(url);
          }}
        />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <ShucodeIntlProvider initialLocale={query.get("locale") === "en" ? "en-US" : "zh-CN"}>
    <Fixture />
  </ShucodeIntlProvider>,
);
