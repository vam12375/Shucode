import { Globe, LoaderIcon } from "lucide-react";
import { TID_BROWSER_QUICK_SITE_ITEM, TID_BROWSER_QUICK_SITES } from "@shucode/shared";
import {
  BROWSER_QUICK_SITE_GROUPS,
  getBrowserQuickSitesByGroup,
  type BrowserQuickSite,
} from "@/browser-use/browserQuickSites.js";
import { runUserAction } from "@/lib/userActionTelemetry.js";

/**
 * 浏览器空状态的快速入口面板（specs/ui/browser-quick-sites.md）。
 *
 * 点击只上抛 onOpenUrl，最终都进 UnifiedBrowserView.openUrl 唯一导航通路；
 * guest 未就绪时由既有 pending 导航队列在 dom-ready 消费，这里不感知加载状态。
 * tint 是主题无关的品牌近似色，仅作固定尺寸图块底色（文件类型图标同一豁免口径），
 * 主题可变的文本/边框一律走语义 token，保证浅深主题都可读。
 */
export function BrowserQuickSitesPanel({
  formatMessage,
  isGuestStarting,
  onOpenUrl,
}: {
  formatMessage: (descriptor: { id: string }) => string;
  isGuestStarting: boolean;
  onOpenUrl: (url: string) => void;
}) {
  return (
    <div
      data-testid={TID_BROWSER_QUICK_SITES}
      className="m-auto flex w-full max-w-lg flex-col gap-6 py-8"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-card-border bg-card text-foreground-subtle">
          {isGuestStarting ? (
            <LoaderIcon className="size-4 animate-spin" />
          ) : (
            <Globe className="size-4" />
          )}
        </span>
        <span className="min-w-0">
          <h3 className="pk-panel-title block truncate text-ui-base font-medium text-foreground">
            {formatMessage({ id: "browser.quickSites.title" })}
          </h3>
          <p className="block truncate text-ui-sm text-foreground-subtle">
            {formatMessage({ id: "browser.quickSites.subtitle" })}
          </p>
        </span>
      </div>
      <div className="flex flex-col gap-5">
        {BROWSER_QUICK_SITE_GROUPS.map((group) => {
          const sites = getBrowserQuickSitesByGroup(group.id);
          const isContentGroup = group.id === "content";
          return (
            <section key={group.id} className="flex min-w-0 flex-col gap-2">
              <h4 className="text-ui-sm font-medium text-foreground-subtle">
                {formatMessage({ id: group.messageId })}
              </h4>
              <div className={isContentGroup ? "grid grid-cols-3 gap-2" : "flex flex-wrap gap-2"}>
                {sites.map((site) => (
                  <BrowserQuickSiteButton
                    key={site.id}
                    site={site}
                    formatMessage={formatMessage}
                    onOpenUrl={onOpenUrl}
                    variant={isContentGroup ? "card" : "chip"}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BrowserQuickSiteButton({
  site,
  formatMessage,
  onOpenUrl,
  variant,
}: {
  site: BrowserQuickSite;
  formatMessage: (descriptor: { id: string }) => string;
  onOpenUrl: (url: string) => void;
  variant: "card" | "chip";
}) {
  const label = formatMessage({ id: `browser.quickSites.${site.id}` });
  return (
    <button
      type="button"
      data-testid={`${TID_BROWSER_QUICK_SITE_ITEM}-${site.id}`}
      onClick={() =>
        runUserAction({
          input: { featureId: "workbench.browser", action: "navigate", trigger: "button" },
          operation: () => onOpenUrl(site.url),
          completed: { resultSource: "optimistic_projection" },
          failureStage: "browser_navigate",
        })
      }
      className={
        variant === "card"
          ? "flex min-w-0 items-center gap-2.5 rounded-xl border border-card-border bg-card px-2.5 py-2.5 text-left transition-colors outline-none hover:bg-surface-hover focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
          : "flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-card-border bg-card px-2 transition-colors outline-none hover:bg-surface-hover focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
      }
    >
      <span
        aria-hidden="true"
        className={
          variant === "card"
            ? "flex size-7 shrink-0 items-center justify-center rounded-lg text-ui-base font-medium text-white"
            : "flex size-5 shrink-0 items-center justify-center rounded-md text-ui-xs font-medium text-white"
        }
        style={{ backgroundColor: site.tint }}
      >
        {site.monogram}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={
            variant === "card"
              ? "block truncate text-ui-base font-medium text-foreground"
              : "block truncate text-ui-base text-foreground"
          }
        >
          {label}
        </span>
        {variant === "card" ? (
          <span className="block truncate text-ui-xs text-foreground-subtlest">{site.domain}</span>
        ) : null}
      </span>
    </button>
  );
}
