import { cn } from "@/components/lib/utils.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import { ThemeHeroVisual, useResolvedThemeHeroPalette } from "@/openWorkspacePageThemeHero.js";

export function OnboardingWelcomeAsciiVisual() {
  const { intl } = useShucodeIntl();
  const palette = useResolvedThemeHeroPalette();

  return (
    <ThemeHeroVisual
      className="pk-onboarding-welcome-art h-full min-h-0 rounded-xl"
      contentClassName="flex h-full items-center justify-center"
    >
      <div className="pk-onboarding-hero-content space-y-4 text-center">
        <div className="space-y-2">
          <p
            className={cn(
              "whitespace-nowrap text-3xl font-semibold leading-[1.08] tracking-tight",
              palette.heading,
            )}
          >
            {intl.formatMessage({ id: "projectSelector.heroTitle" })}
          </p>
          <p
            className={cn("mx-auto whitespace-nowrap text-ui-base leading-6", palette.description)}
          >
            {intl.formatMessage({ id: "projectSelector.heroDescription" })}
          </p>
        </div>
      </div>
    </ThemeHeroVisual>
  );
}
