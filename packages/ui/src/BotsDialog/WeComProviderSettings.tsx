import { ExternalLink, KeyRound, LoaderCircle, QrCode } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import type { WeComRegistrationState } from "./shared.js";

/**
 * 企业微信接入面板：主路径是扫码创建机器人（成功后 BotID 与 Secret 一次到位），
 * 扫码接口不可用时退回手动粘贴 BotID + Secret。
 */
export function WeComProviderSettings({
  registration,
  registrationLoading,
  saving,
  onStartRegistration,
  onSaveManualCredentials,
}: {
  registration: WeComRegistrationState | null;
  registrationLoading: boolean;
  saving: boolean;
  onStartRegistration: () => void;
  onSaveManualCredentials: (params: { botId: string; secret: string }) => void;
}) {
  const { intl } = useShucodeIntl();
  const [manualBotId, setManualBotId] = useState("");
  const [manualSecret, setManualSecret] = useState("");
  const [manualExpanded, setManualExpanded] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-center gap-4">
        {registration?.qrDataUrl ? (
          <img
            src={registration.qrDataUrl}
            alt={intl.formatMessage({ id: "bots.wecomRegistrationQrAlt" })}
            className="size-40 shrink-0 rounded-lg border border-border bg-surface p-2"
          />
        ) : null}
        <div className="min-w-52 flex-1 space-y-3 text-ui-base text-foreground-subtle">
          <div>{intl.formatMessage({ id: "bots.wecomRegistrationScanHint" })}</div>
          {registration ? (
            <div>
              {registration.status === "pending" ? (
                <span className="inline-flex items-center gap-1">
                  <LoaderCircle className="size-3 animate-spin" />
                  {intl.formatMessage({ id: "bots.wecomRegistration.pending" })}
                </span>
              ) : (
                (registration.message ??
                intl.formatMessage({ id: `bots.wecomRegistration.${registration.status}` }))
              )}
            </div>
          ) : null}
          {registration ? (
            <a
              className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
              href={registration.qrPageUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-3" />
              {intl.formatMessage({ id: "bots.wecomRegistrationOpenPage" })}
            </a>
          ) : null}
          <Button
            variant="outline"
            size="lg"
            onClick={onStartRegistration}
            disabled={registrationLoading}
          >
            {registrationLoading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <QrCode className="size-4" />
            )}
            {intl.formatMessage({
              id: registration ? "bots.wecomRegistrationRefresh" : "bots.wecomRegistrationButton",
            })}
          </Button>
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <button
          type="button"
          className="text-ui-base text-foreground-subtle underline-offset-2 hover:underline"
          onClick={() => setManualExpanded((current) => !current)}
        >
          {intl.formatMessage({ id: "bots.wecomManualToggle" })}
        </button>
        {manualExpanded ? (
          <div className="mt-3 space-y-2">
            <div className="text-ui-base leading-5 text-foreground-subtle">
              {intl.formatMessage({ id: "bots.wecomManualHint" })}
            </div>
            <Input
              size="lg"
              value={manualBotId}
              onChange={(event) => setManualBotId(event.target.value)}
              placeholder={intl.formatMessage({ id: "bots.wecomBotIdPlaceholder" })}
              disabled={saving}
            />
            <div className="flex w-full min-w-0 items-center gap-2">
              <Input
                size="lg"
                type="password"
                value={manualSecret}
                onChange={(event) => setManualSecret(event.target.value)}
                placeholder={intl.formatMessage({ id: "bots.credentialPlaceholder" })}
                className="min-w-0 flex-1"
                disabled={saving}
              />
              <Button
                variant="outline"
                size="lg"
                onClick={() =>
                  onSaveManualCredentials({
                    botId: manualBotId.trim(),
                    secret: manualSecret.trim(),
                  })
                }
                disabled={saving || !manualBotId.trim() || !manualSecret.trim()}
              >
                {saving ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <KeyRound className="size-4" />
                )}
                {intl.formatMessage({ id: "bots.saveSecret" })}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
