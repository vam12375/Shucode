import type { ReactNode } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";

export function UsageSelect({
  value,
  onChange,
  label,
  options,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: { value: string; label: string }[];
  testId?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        data-testid={testId}
        className="max-w-full"
        size="lg"
        variant="outline"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function UsageIconButton({
  label,
  children,
  onClick,
  disabled,
  testId,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          data-testid={testId}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export const USAGE_TABLE_CLASS =
  "w-full border-collapse whitespace-nowrap text-ui-sm [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-subtle [&_td]:px-3 [&_td]:py-2.5 [&_tbody_tr]:border-b [&_tbody_tr]:border-border/60 [&_tbody_tr:hover]:bg-hover";
