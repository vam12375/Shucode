import { useEffect, useMemo, useState } from "react";
import type { UsageModelPrice } from "@shucode/shared";
import { useServices } from "@/hooks/useServices.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Input } from "@/components/ui/input.js";
import { filterModelsDevPrices } from "./usageDashboardViewModel.js";
import { USAGE_TABLE_CLASS } from "./UsageDashboardControls.js";

export function UsageModelsDevDialog({
  selectedKeys,
  busy,
  operationError,
  onClose,
  onImport,
}: {
  selectedKeys: string[];
  busy: boolean;
  operationError?: string | null;
  onClose: () => void;
  onImport: (keys: string[]) => Promise<boolean>;
}) {
  const { usageStatsService } = useServices();
  const { intl } = useShucodeIntl();
  const [catalog, setCatalog] = useState<UsageModelPrice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set(selectedKeys));
  const msg = (key: string) => intl.formatMessage({ id: `usageDashboard.${key}` });
  useEffect(() => {
    let active = true;
    void usageStatsService
      .getModelsDevPrices()
      .then((prices) => {
        if (active) setCatalog(prices);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      active = false;
    };
  }, [usageStatsService]);
  const results = useMemo(() => filterModelsDevPrices(catalog ?? [], search), [catalog, search]);
  const toggle = (key: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-3xl"
        data-testid="usage-modelsdev-dialog"
      >
        <DialogHeader>
          <DialogTitle>{msg("import")}</DialogTitle>
          <DialogDescription>{msg("catalogHint")}</DialogDescription>
        </DialogHeader>
        <p className="text-ui-xs text-foreground-subtle">{msg("pricingUnit")}</p>
        <Input
          size="lg"
          aria-label={msg("catalogSearch")}
          placeholder={msg("catalogSearch")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          data-testid="usage-catalog-search"
        />
        {error ? (
          <p role="alert" className="text-ui-sm text-destructive">
            {error}
          </p>
        ) : null}
        {operationError ? (
          <p role="alert" className="text-ui-sm text-destructive">
            {operationError}
          </p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className={USAGE_TABLE_CLASS}>
            <thead className="sticky top-0 bg-popover">
              <tr>
                <th>
                  <Checkbox
                    aria-label={msg("selectAll")}
                    disabled={busy || !results.length}
                    checked={
                      results.length > 0 &&
                      results.every((price) => !!price.catalogKey && selected.has(price.catalogKey))
                    }
                    onCheckedChange={(checked) => {
                      setSelected((current) => {
                        const next = new Set(current);
                        for (const price of results) {
                          if (price.catalogKey) {
                            if (checked) next.add(price.catalogKey);
                            else next.delete(price.catalogKey);
                          }
                        }
                        return next;
                      });
                    }}
                  />
                </th>
                {[
                  "provider",
                  "model",
                  "inputPrice",
                  "outputPrice",
                  "cacheReadPrice",
                  "cacheWritePrice",
                ].map((key) => (
                  <th key={key}>{msg(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((price) => (
                <tr key={price.catalogKey}>
                  <td>
                    <Checkbox
                      aria-label={`${price.providerId ?? ""} ${price.modelId}`}
                      checked={!!price.catalogKey && selected.has(price.catalogKey)}
                      disabled={busy}
                      onCheckedChange={(checked) => {
                        if (price.catalogKey) toggle(price.catalogKey, checked === true);
                      }}
                    />
                  </td>
                  <td>{price.providerId}</td>
                  <td className="font-mono">{price.modelId}</td>
                  <td>{price.inputUSD}</td>
                  <td>{price.outputUSD}</td>
                  <td>{price.cacheReadUSD ?? "--"}</td>
                  <td>{price.cacheWriteUSD ?? "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!catalog && !error ? (
            <p className="py-10 text-center text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "settings.usage.loadingTitle" })}
            </p>
          ) : null}
          {catalog && !results.length ? (
            <p className="py-10 text-center text-ui-sm text-foreground-subtle">{msg("noPrices")}</p>
          ) : null}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {msg("cancel")}
          </Button>
          <Button
            disabled={busy || !catalog || selected.size === 0}
            data-testid="usage-catalog-import"
            onClick={() =>
              void onImport([...selected]).then((saved) => {
                if (saved) onClose();
              })
            }
          >
            {intl.formatMessage({ id: "usageDashboard.importSelected" }, { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
