import { Pencil, Plus, RefreshCcw, Trash2, Download, FileJson } from "lucide-react";
import { useEffect, useState } from "react";
import { usagePriceKey } from "@shucode/shared";
import type { UsageModelPrice } from "@shucode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Switch } from "@/components/ui/switch.js";
import { useUsagePricing, USAGE_PRICING_METHOD_NOT_FOUND } from "@/hooks/useUsagePricing.js";
import { useServices } from "@/hooks/useServices.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import { UsagePriceDialog } from "./UsagePriceDialog.js";
import { UsageModelsDevDialog } from "./UsageModelsDevDialog.js";
import { UsagePricingJsonDialog } from "./UsagePricingJsonDialog.js";
import { UsageIconButton, USAGE_TABLE_CLASS } from "./UsageDashboardControls.js";

export function UsagePricingPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const { intl, locale } = useShucodeIntl();
  const { settings, busy, error, run } = useUsagePricing(onChanged);
  const { usageStatsService } = useServices();
  const [edit, setEdit] = useState<{ price?: UsageModelPrice } | null>(null);
  const [deleting, setDeleting] = useState<UsageModelPrice | null>(null);
  const [importing, setImporting] = useState(false);
  const [importingJson, setImportingJson] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(
    null,
  );
  useEffect(() => {
    // 编辑草稿属于打开弹窗时的 Environment，切换服务后不能把旧供应商价格写入新 Host。
    setEdit(null);
    setDeleting(null);
    setImporting(false);
    setImportingJson(false);
    setImportResult(null);
  }, [usageStatsService]);
  const msg = (key: string) => intl.formatMessage({ id: `usageDashboard.${key}` });
  const pricingError = error
    ? error === USAGE_PRICING_METHOD_NOT_FOUND
      ? msg("restartAppToImport")
      : error
    : null;
  const prices = settings?.entries ?? [];
  return (
    <div className="space-y-4" data-testid="usage-pricing-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-ui-base font-medium">{msg("pricingUnit")}</h3>
          <p className="mt-1 text-ui-sm text-foreground-subtle">{msg("pricingHint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setImportingJson(true)}
            data-testid="usage-pricing-import-json"
          >
            <FileJson />
            {msg("importJson")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setImporting(true)}
            data-testid="usage-pricing-import"
          >
            <Download />
            {msg("import")}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => setEdit({})}
            data-testid="usage-pricing-add"
          >
            <Plus />
            {msg("addPrice")}
          </Button>
        </div>
      </div>
      {pricingError ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {pricingError}
        </p>
      ) : null}
      {importResult ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "usageDashboard.jsonImportResult" }, importResult)}
        </p>
      ) : null}
      <div className="max-w-full overflow-x-auto">
        <table className={USAGE_TABLE_CLASS}>
          <thead className="border-b border-border">
            <tr>
              {[
                "model",
                "provider",
                "inputPrice",
                "outputPrice",
                "cacheReadPrice",
                "cacheWritePrice",
                "source",
              ].map((key) => (
                <th key={key}>{msg(key)}</th>
              ))}
              <th aria-label={msg("editPrice")} />
            </tr>
          </thead>
          <tbody>
            {prices.map((price) => (
              <tr key={usagePriceKey(price)}>
                <td className="font-mono">
                  <div>{price.modelId}</div>
                  {price.displayName ? (
                    <div className="mt-1 font-sans text-ui-xs text-foreground-subtle">
                      {price.displayName}
                    </div>
                  ) : null}
                </td>
                <td>{price.providerId || msg("allProviders")}</td>
                <td className="font-mono tabular-nums">{price.inputUSD}</td>
                <td className="font-mono tabular-nums">{price.outputUSD}</td>
                <td className="font-mono tabular-nums">{price.cacheReadUSD ?? "--"}</td>
                <td className="font-mono tabular-nums">{price.cacheWriteUSD ?? "--"}</td>
                <td className="text-foreground-subtle">
                  {msg(price.source === "manual" ? "manual" : "catalog")}
                </td>
                <td>
                  <div className="flex gap-1">
                    <UsageIconButton
                      label={msg("editPrice")}
                      disabled={busy}
                      onClick={() => setEdit({ price })}
                      testId={`usage-price-edit-${price.modelId}`}
                    >
                      <Pencil />
                    </UsageIconButton>
                    <UsageIconButton
                      label={msg("deletePrice")}
                      disabled={busy}
                      onClick={() => setDeleting(price)}
                      testId={`usage-price-delete-${price.modelId}`}
                    >
                      <Trash2 />
                    </UsageIconButton>
                  </div>
                </td>
              </tr>
            ))}
            {!prices.length ? (
              <tr>
                <td colSpan={8} className="h-28 text-center text-foreground-subtle">
                  {busy
                    ? intl.formatMessage({ id: "settings.usage.loadingTitle" })
                    : msg("noPrices")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <label className="flex items-center gap-2 text-ui-sm">
          <Switch
            checked={settings?.modelsDevAutoSync ?? false}
            disabled={busy || !settings}
            onCheckedChange={(enabled) =>
              void run((service) => service.setModelsDevAutoSync(enabled))
            }
            data-testid="usage-pricing-autosync"
          />
          {msg("autoSync")}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-ui-xs text-foreground-subtle">
            {settings?.lastSyncedAt
              ? intl.formatMessage(
                  { id: "usageDashboard.syncedAt" },
                  {
                    time: new Intl.DateTimeFormat(locale, {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(settings.lastSyncedAt),
                  },
                )
              : msg("neverSynced")}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !settings?.modelsDevSelectedKeys.length}
            onClick={() => void run((service) => service.syncModelsDevPrices())}
            data-testid="usage-pricing-sync"
          >
            <RefreshCcw className={busy ? "animate-spin" : ""} />
            {msg("sync")}
          </Button>
        </div>
      </div>
      {edit ? (
        <UsagePriceDialog
          price={edit.price}
          busy={busy}
          error={error}
          onClose={() => setEdit(null)}
          onSave={(price) =>
            run((service) =>
              service.savePrice(price, edit.price ? usagePriceKey(edit.price) : undefined),
            )
          }
        />
      ) : null}
      {importing ? (
        <UsageModelsDevDialog
          selectedKeys={settings?.modelsDevSelectedKeys ?? []}
          busy={busy}
          operationError={error}
          onClose={() => setImporting(false)}
          onImport={(keys) => run((service) => service.importModelsDevPrices(keys))}
        />
      ) : null}
      {importingJson ? (
        <UsagePricingJsonDialog
          busy={busy}
          error={pricingError}
          onClose={() => setImportingJson(false)}
          onImport={(json) =>
            run(
              async (service) => {
                const result = await service.importCcSwitchPrices(json);
                setImportResult({ imported: result.imported, skipped: result.skipped });
                return result.settings;
              },
              true,
              "importCcSwitchPrices",
            )
          }
        />
      ) : null}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{msg("deletePrice")}</DialogTitle>
            <DialogDescription>
              {intl.formatMessage(
                { id: "usageDashboard.deleteConfirm" },
                { model: deleting?.modelId ?? "" },
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>
              {msg("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              data-testid="usage-price-confirm-delete"
              onClick={() => {
                if (deleting)
                  void run((service) => service.deletePrice(usagePriceKey(deleting))).then(
                    (removed) => {
                      if (removed) setDeleting(null);
                    },
                  );
              }}
            >
              {msg("confirmDelete")}
            </Button>
          </DialogFooter>
          {error ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
