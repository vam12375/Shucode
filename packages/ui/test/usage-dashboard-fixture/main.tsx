import { createRoot } from "react-dom/client";
import { useState } from "react";
import type { IServiceAccessor, IBroadcastService } from "@shucode/services";
import { ServiceProvider } from "../../src/hooks/useServices.js";
import { ShucodeIntlProvider, useShucodeIntl } from "../../src/i18n/IntlProvider.js";
import { TooltipProvider } from "../../src/components/ui/tooltip.js";
import { StoreProvider } from "../../src/store/StoreProvider.js";
import { UsageDashboardPanel } from "../../src/settings/usage-stats/UsageDashboardPanel.js";
import {
  UsageScopeSelector,
  type UsageScope,
} from "../../src/settings/usage-stats/UsageClientSelector.js";
import { applyTheme } from "../../src/useTheme.js";
import { usageStatsService, fixtureControls } from "./service.js";
import "../../src/styles.css";

const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle(
  "platform-mac-desktop",
  query.get("platform") === "desktop",
);
document.documentElement.setAttribute("data-shucode-browser-theme", "light");
applyTheme(query.get("theme") === "dark" ? "zai-dark" : "zai-light");
localStorage.setItem("shucode-theme", query.get("theme") === "dark" ? "zai-dark" : "zai-light");
const services = { usageStatsService } as IServiceAccessor;
const broadcastService: IBroadcastService = {
  send: async () => {},
  acquireClaim: async () => ({ status: "unavailable" }),
  commitClaim: async () => {},
  releaseClaim: async () => {},
  tryClaim: async () => true,
  onMessage: () => ({ dispose() {} }),
};
(window as Window & { usageFixture?: typeof fixtureControls }).usageFixture = fixtureControls;

function Fixture() {
  const [scope, setScope] = useState<UsageScope>("shucode");
  const { intl } = useShucodeIntl();
  return (
    <main className="pk-settings-page h-screen overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-ui-xl font-medium">
            {intl.formatMessage({ id: "settings.usageTitle" })}
          </h1>
          <UsageScopeSelector scope={scope} onChange={setScope} />
        </header>
        <UsageDashboardPanel key={scope} scope={scope} onScopeChange={setScope} />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <ShucodeIntlProvider initialLocale={query.get("locale") === "en" ? "en-US" : "zh-CN"}>
    <StoreProvider broadcastService={broadcastService}>
      <ServiceProvider services={services}>
        <TooltipProvider>
          <Fixture />
        </TooltipProvider>
      </ServiceProvider>
    </StoreProvider>
  </ShucodeIntlProvider>,
);
