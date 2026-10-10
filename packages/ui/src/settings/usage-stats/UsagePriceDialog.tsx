import { useState } from "react";
import type { UsageModelPrice } from "@shucode/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import {
  createUsagePriceDraft,
  parseUsagePriceDraft,
  type UsagePriceDraft,
} from "./usageDashboardViewModel.js";

export function UsagePriceDialog({
  price,
  busy,
  error,
  onClose,
  onSave,
}: {
  price?: UsageModelPrice;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (price: UsageModelPrice) => Promise<boolean>;
}) {
  const { intl } = useShucodeIntl();
  const [draft, setDraft] = useState(() => createUsagePriceDraft(price));
  const [invalid, setInvalid] = useState(false);
  const msg = (key: string) => intl.formatMessage({ id: `usageDashboard.${key}` });
  const fields: { key: keyof UsagePriceDraft; label: string; numeric?: boolean }[] = [
    { key: "modelId", label: "modelId" },
    { key: "providerId", label: "providerId" },
    { key: "displayName", label: "displayName" },
    { key: "inputUSD", label: "inputPrice", numeric: true },
    { key: "outputUSD", label: "outputPrice", numeric: true },
    { key: "cacheReadUSD", label: "cacheReadPrice", numeric: true },
    { key: "cacheWriteUSD", label: "cacheWritePrice", numeric: true },
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="usage-price-dialog">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = parseUsagePriceDraft(draft);
            setInvalid(!parsed);
            if (parsed)
              void onSave(parsed).then((saved) => {
                if (saved) onClose();
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{msg(price ? "editPrice" : "addPrice")}</DialogTitle>
            <DialogDescription>{msg("pricingUnit")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <label
                key={field.key}
                className={`space-y-1.5 text-ui-sm ${field.key === "displayName" ? "sm:col-span-2" : ""}`}
              >
                <span>{msg(field.label)}</span>
                <Input
                  size="lg"
                  type={field.numeric ? "number" : "text"}
                  min={field.numeric ? 0 : undefined}
                  step={field.numeric ? "any" : undefined}
                  value={draft[field.key]}
                  disabled={busy}
                  required={
                    field.key === "modelId" || field.key === "inputUSD" || field.key === "outputUSD"
                  }
                  data-testid={`usage-price-${field.key}`}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          {invalid ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {msg("priceInvalid")}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {msg("cancel")}
            </Button>
            <Button type="submit" disabled={busy} data-testid="usage-price-save">
              {msg("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
