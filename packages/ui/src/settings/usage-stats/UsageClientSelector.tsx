import { AppWindow, Code, Pi, Sparkles, Terminal, Waves, Zap } from "lucide-react";
import type { AppUsageDashboard } from "@shucode/shared";
import { USAGE_CLIENT_IDS } from "@shucode/shared";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import { GlmMonochromeIcon } from "@/components/ui/GlmMonochromeIcon.js";
import openAiLogo from "@/assets/provider-icons/model-provider-openai.png";
import anthropicLogo from "@/assets/provider-icons/model-provider-anthropic.png";

export type UsageClientId = (typeof USAGE_CLIENT_IDS)[number];
export type UsageScope = "shucode" | "all-clients";
const LABELS: Record<UsageClientId, string> = {
  shucode: "Shucode",
  codex: "Codex",
  "claude-code": "Claude Code",
  "dsh-desktop": "DSH Desktop",
  pi: "Pi",
  gemini: "Gemini",
  opencode: "OpenCode",
  "grok-build": "Grok Build",
  "minimax-code": "MiniMax Code",
};

export function UsageClientIcon({ id }: { id: string }) {
  if (id === "shucode") return <GlmMonochromeIcon className="size-4" />;
  if (id === "codex" || id === "claude-code")
    return (
      <img
        src={id === "codex" ? openAiLogo : anthropicLogo}
        alt=""
        aria-hidden="true"
        className="size-4 object-contain"
      />
    );
  const Icon =
    id === "pi"
      ? Pi
      : id === "gemini"
        ? Sparkles
        : id === "opencode"
          ? Code
          : id === "dsh-desktop"
            ? AppWindow
            : id === "grok-build"
              ? Zap
              : id === "minimax-code"
                ? Waves
                : Terminal;
  return <Icon className="size-4" />;
}

export function UsageScopeSelector({
  scope,
  onChange,
}: {
  scope: UsageScope;
  onChange: (scope: UsageScope) => void;
}) {
  const { intl } = useShucodeIntl();
  return (
    <Tabs
      className="pk-usage-scope"
      value={scope}
      onValueChange={(value) => onChange(value as UsageScope)}
    >
      <TabsList className="rounded-full border border-border bg-surface">
        <TabsTrigger
          value="shucode"
          className="rounded-full px-3 data-active:bg-background data-active:shadow-sm"
          data-testid="usage-scope-shucode"
        >
          Shucode
        </TabsTrigger>
        <TabsTrigger
          value="all-clients"
          className="rounded-full px-3 data-active:bg-background data-active:shadow-sm"
          data-testid="usage-scope-all-clients"
        >
          {intl.formatMessage({ id: "usageDashboard.scope.all-clients" })}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

export function UsageClientSelector({
  options,
  clientId,
  onChange,
}: {
  options: AppUsageDashboard["clientOptions"];
  clientId?: UsageClientId;
  onChange: (clientId?: UsageClientId) => void;
}) {
  const { intl } = useShucodeIntl();
  const known = new Map(options.map((option) => [option.id, option]));
  return (
    <Tabs
      className="pk-usage-clients min-w-0 max-w-full overflow-x-auto"
      value={clientId ?? "all"}
      onValueChange={(value) => onChange(value === "all" ? undefined : (value as UsageClientId))}
    >
      <TabsList className="w-max rounded-full border border-border bg-surface">
        <TabsTrigger value="all" className="rounded-full px-3" data-testid="usage-client-all">
          {intl.formatMessage({ id: "usageDashboard.allClients" })}
        </TabsTrigger>
        {USAGE_CLIENT_IDS.map((id) => {
          const option = known.get(id);
          const label = option?.label ?? LABELS[id];
          const title = option?.available
            ? label
            : `${label}: ${option?.error || intl.formatMessage({ id: "usageDashboard.clientUnavailable" })}`;
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value={id}
                  className="size-8 shrink-0 rounded-full p-0"
                  aria-label={label}
                  title={title}
                  data-testid={`usage-client-${id}`}
                >
                  <span className={!option?.available ? "opacity-40" : ""}>
                    <UsageClientIcon id={id} />
                  </span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>{title}</TooltipContent>
            </Tooltip>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
