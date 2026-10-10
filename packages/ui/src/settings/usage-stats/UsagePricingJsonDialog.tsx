import { useState } from "react";
import { FileJson } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";

export function UsagePricingJsonDialog({
  busy,
  error,
  onClose,
  onImport,
}: {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onImport: (json: string) => Promise<boolean>;
}) {
  const { intl } = useShucodeIntl();
  const [json, setJson] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const msg = (key: string) => intl.formatMessage({ id: `usageDashboard.${key}` });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl" data-testid="usage-pricing-json-dialog">
        <DialogHeader>
          <DialogTitle>{msg("importJson")}</DialogTitle>
          <DialogDescription>{msg("importJsonHint")}</DialogDescription>
        </DialogHeader>
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-ui-sm hover:bg-hover">
          <FileJson className="size-4" />
          {msg("chooseJson")}
          <input
            className="sr-only"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            data-testid="usage-pricing-json-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) {
                setFileError(msg("jsonTooLarge"));
                return;
              }
              void file
                .text()
                .then((text) => {
                  setJson(text);
                  setFileError(null);
                })
                .catch((failure: unknown) =>
                  setFileError(failure instanceof Error ? failure.message : String(failure)),
                );
            }}
          />
        </label>
        <textarea
          className="h-72 min-w-0 resize-y rounded-lg border border-input-border bg-input p-3 font-mono text-ui-sm outline-none focus:border-input-border-focused"
          aria-label={msg("pasteJson")}
          placeholder={msg("pasteJson")}
          value={json}
          disabled={busy}
          onChange={(event) => setJson(event.target.value)}
          data-testid="usage-pricing-json-text"
        />
        {fileError || error ? (
          <p role="alert" className="break-words text-ui-sm text-destructive">
            {fileError || error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {msg("cancel")}
          </Button>
          <Button
            disabled={busy || !json.trim()}
            data-testid="usage-pricing-json-import"
            onClick={() =>
              void onImport(json).then((saved) => {
                if (saved) onClose();
              })
            }
          >
            {msg("importJsonConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
