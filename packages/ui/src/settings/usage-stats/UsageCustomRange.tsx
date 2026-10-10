import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";

function localDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function UsageCustomRange({
  value,
  onChange,
}: {
  value: { since: number; until?: number };
  onChange: (value: { since: number; until?: number }) => void;
}) {
  const { intl } = useShucodeIntl();
  const [since, setSince] = useState(() => localDateTime(value.since));
  const [until, setUntil] = useState(() => localDateTime(value.until ?? Date.now()));
  const [followNow, setFollowNow] = useState(value.until === undefined);
  const [invalid, setInvalid] = useState(false);
  const msg = (key: string) => intl.formatMessage({ id: `usageDashboard.${key}` });
  return (
    <form
      className="flex flex-wrap items-end gap-3 border-t border-border pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        const start = new Date(since).getTime();
        const end = followNow ? Date.now() : new Date(until).getTime();
        const valid = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start <= end;
        setInvalid(!valid);
        if (valid) onChange({ since: start, until: followNow ? undefined : end });
      }}
    >
      <label className="min-w-0 space-y-1 text-ui-sm">
        <span>{msg("customStart")}</span>
        <Input
          size="lg"
          type="datetime-local"
          min="1970-01-01T00:00"
          required
          value={since}
          onChange={(event) => setSince(event.target.value)}
          data-testid="usage-custom-since"
        />
      </label>
      <label className="min-w-0 space-y-1 text-ui-sm">
        <span>{msg("customEnd")}</span>
        <Input
          size="lg"
          type="datetime-local"
          min="1970-01-01T00:00"
          required={!followNow}
          disabled={followNow}
          value={until}
          onChange={(event) => setUntil(event.target.value)}
          data-testid="usage-custom-until"
        />
      </label>
      <label className="flex h-8 items-center gap-2 text-ui-sm">
        <Switch
          checked={followNow}
          onCheckedChange={setFollowNow}
          data-testid="usage-custom-follow-now"
        />
        {msg("followNow")}
      </label>
      <Button type="submit" size="sm" variant="outline" data-testid="usage-custom-apply">
        {msg("applyRange")}
      </Button>
      {invalid ? (
        <p role="alert" className="w-full text-ui-sm text-destructive">
          {msg("invalidRange")}
        </p>
      ) : null}
    </form>
  );
}
