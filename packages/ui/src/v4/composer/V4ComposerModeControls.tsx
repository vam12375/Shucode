import { memo, useCallback, useMemo, useState } from "react";
import {
  FolderIcon,
  GlobeIcon,
  LightbulbIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  XIcon,
  ChevronDownIcon,
} from "lucide-react";
import {
  TID_CHAT_MODE_SELECT_TRIGGER,
  TID_CHAT_MODE_SELECT_ITEM,
  TID_V4_COMPOSER_INPUT,
  SHUCODE_AGENT_PROVIDER,
  getShucodeAgentAvailableModes,
  testId,
  type ShucodeConfigOption,
} from "@shucode/shared";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import {
  getModeOptionDisplayLabel,
  getModeOptionDescriptionMessageId,
  resolveModeOptionIcon,
} from "@/chat-input-toolbar/display.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import { isCoarseTouchDevice } from "@/lib/pickerFocus.js";
import { useShortcutCommandLabel } from "@/shortcuts/useShortcutBindings.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import {
  getNextConfigSelectValue,
  useToolbarShortcutBindings,
} from "@/v4/composer/toolbarShortcuts.js";
import type { V4ComposerToolbarProps } from "@/v4/composer/V4ComposerToolbar.js";

function noop(): void {}

/** Codex 同款确认框：进入完全访问前列出授予的能力与风险，确认才放行（见 specs/ui/composer-full-access-confirm.md）。 */
function FullAccessConfirmDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { intl } = useShucodeIntl();
  const capabilities = [
    {
      icon: <FolderIcon className="size-4.5 shrink-0 text-foreground-subtle" />,
      titleId: "mode.confirm.yolo.files",
      descriptionId: "mode.confirm.yolo.files.description",
    },
    {
      icon: <SquareTerminalIcon className="size-4.5 shrink-0 text-foreground-subtle" />,
      titleId: "mode.confirm.yolo.commands",
      descriptionId: "mode.confirm.yolo.commands.description",
    },
    {
      icon: <GlobeIcon className="size-4.5 shrink-0 text-foreground-subtle" />,
      titleId: "mode.confirm.yolo.network",
      descriptionId: "mode.confirm.yolo.network.description",
    },
  ];
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent data-testid="composer-full-access-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <TriangleAlertIcon className="size-5 shrink-0 text-warning" />
            {intl.formatMessage({ id: "mode.confirm.yolo.title" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {intl.formatMessage({ id: "mode.confirm.yolo.description" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {capabilities.map((capability) => (
            <div key={capability.titleId} className="flex items-start gap-3 px-4 py-3">
              {capability.icon}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui-base font-medium text-foreground">
                  {intl.formatMessage({ id: capability.titleId })}
                </span>
                <span className="text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: capability.descriptionId })}
                </span>
              </span>
            </div>
          ))}
        </div>
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "mode.confirm.yolo.warning" })}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel type="button" size="sm" data-testid="composer-full-access-cancel">
            {intl.formatMessage({ id: "common.cancel" })}
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            size="sm"
            data-testid="composer-full-access-confirm"
            onClick={onConfirm}
          >
            {intl.formatMessage({ id: "mode.confirm.yolo.confirm" })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Plan 是独立勾选项，三种权限仍为单选；只编辑草稿，不向 Runtime 发切换命令。 */
function V4ComposerModeSwitchImpl({
  provider,
  draftConfig,
  disabled,
  activeConfigPicker,
  onConfigPickerOpenChange,
  onSwitchMode,
}: Pick<
  V4ComposerToolbarProps,
  | "workspacePath"
  | "workspaceIdentity"
  | "provider"
  | "draftConfig"
  | "disabled"
  | "activeConfigPicker"
  | "onConfigPickerOpenChange"
  | "onSwitchMode"
>) {
  const { intl } = useShucodeIntl();
  const displayProvider = provider ?? SHUCODE_AGENT_PROVIDER;
  // 进入 yolo 的确认门卫只持有"弹窗是否打开"，不持有模式状态；模式仍由 onSwitchMode 唯一写入。
  const [pendingYoloConfirm, setPendingYoloConfirm] = useState(false);
  const modeShortcutLabel = useShortcutCommandLabel("cycleSessionMode");
  const modes = getShucodeAgentAvailableModes();
  const permissions = modes.filter((mode) => mode.id !== "plan");
  const selected = permissions.find((mode) => mode.id === draftConfig?.mode);
  const label = (mode: (typeof modes)[number]) =>
    getModeOptionDisplayLabel(intl, displayProvider, { value: mode.id, name: mode.name });
  const plan = modes.find((mode) => mode.id === "plan")!;
  const planLabel = label(plan);
  // Plan 拆成独立勾选项后仍需保留原菜单说明，复用相同的国际化映射。
  const planDescriptionId = getModeOptionDescriptionMessageId(displayProvider, { value: plan.id });
  const modeOption = useMemo<ShucodeConfigOption>(
    () => ({
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: draftConfig?.mode ?? "build",
      options: getShucodeAgentAvailableModes()
        .filter((mode) => mode.id !== "plan")
        .map((mode) => ({ value: mode.id, name: mode.name })),
    }),
    [draftConfig?.mode],
  );
  // 唯一的模式切换门卫：进入 yolo 先弹确认，其余模式（含 plan / plan-off）直接放行。
  const requestModeSwitch = useCallback(
    (next: string) => {
      if (next === "yolo" && draftConfig?.mode !== "yolo") {
        setPendingYoloConfirm(true);
        // 菜单先收起，让确认框成为唯一的视觉焦点（Codex 同款）。
        onConfigPickerOpenChange("mode", false);
        return;
      }
      onSwitchMode(next);
    },
    [draftConfig?.mode, onConfigPickerOpenChange, onSwitchMode],
  );
  const cycle = useCallback(() => {
    const next = getNextConfigSelectValue(modeOption);
    if (next) requestModeSwitch(next);
  }, [modeOption, requestModeSwitch]);
  useToolbarShortcutBindings({
    hasAnyOption: Boolean(selected),
    toolbarDisabled: disabled,
    modelMenuDisabled: true,
    modeOption,
    onCycleSessionMode: cycle,
    onOpenModelMenu: noop,
    onCycleThoughtLevel: noop,
  });
  if (!selected) return null;
  const Icon = resolveModeOptionIcon(selected.id);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu
        open={activeConfigPicker === "mode"}
        onOpenChange={(open) => onConfigPickerOpenChange("mode", open)}
      >
        <ControlHintTooltip
          title={intl.formatMessage({ id: "chat.toolbar.mode.label" })}
          shortcut={modeShortcutLabel}
          open={activeConfigPicker === "mode" ? false : undefined}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              data-testid={TID_CHAT_MODE_SELECT_TRIGGER}
              data-composer-collapse-priority="1"
              aria-label={intl.formatMessage({ id: "chat.toolbar.mode.label" })}
              className={cn(
                "group/mode h-7 gap-1 rounded-lg px-2 text-ui-base data-[composer-compact=true]:w-7 data-[composer-compact=true]:px-0",
                selected.id === "yolo" && "text-warning hover:text-warning",
              )}
            >
              <Icon className="size-4" />
              <span className="inline group-data-[composer-compact=true]/mode:hidden">
                {label(selected)}
              </span>
              <ChevronDownIcon className="size-3.5 group-data-[composer-compact=true]/mode:hidden" />
            </Button>
          </DropdownMenuTrigger>
        </ControlHintTooltip>
        <DropdownMenuContent
          side="top"
          sideOffset={4}
          className="w-64"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!isCoarseTouchDevice())
              document
                .querySelector<HTMLElement>(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`)
                ?.focus();
          }}
        >
          <DropdownMenuCheckboxItem
            checked={draftConfig?.planEnabled ?? false}
            onCheckedChange={(checked) => onSwitchMode(checked ? "plan" : "plan-off")}
            data-testid={testId(TID_CHAT_MODE_SELECT_ITEM, "plan")}
            className="min-h-13 items-start gap-3 py-2"
          >
            <LightbulbIcon className="mt-0.5 size-4.5 shrink-0" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span>{planLabel}</span>
              {planDescriptionId && (
                <span className="text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: planDescriptionId })}
                </span>
              )}
            </span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={selected.id} onValueChange={requestModeSwitch}>
            {permissions.map((mode) => {
              const ModeIcon = resolveModeOptionIcon(mode.id);
              const descriptionId = getModeOptionDescriptionMessageId(displayProvider, {
                value: mode.id,
              });
              return (
                <DropdownMenuRadioItem
                  key={mode.id}
                  value={mode.id}
                  data-testid={testId(TID_CHAT_MODE_SELECT_ITEM, mode.id)}
                  className="min-h-13 items-start gap-3 py-2"
                >
                  <ModeIcon className="mt-0.5 size-4.5 shrink-0" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>{label(mode)}</span>
                    {descriptionId && (
                      <span className="text-ui-sm text-foreground-subtle">
                        {intl.formatMessage({ id: descriptionId })}
                      </span>
                    )}
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <FullAccessConfirmDialog
        open={pendingYoloConfirm}
        onCancel={() => setPendingYoloConfirm(false)}
        onConfirm={() => {
          setPendingYoloConfirm(false);
          onSwitchMode("yolo");
        }}
      />
      {draftConfig?.planEnabled && (
        <span data-testid="v4-composer-plan-marker" className="flex items-center gap-1">
          <span
            role="separator"
            aria-orientation="vertical"
            className="h-3 w-px shrink-0 bg-border"
          />
          <ControlHintTooltip title={intl.formatMessage({ id: "chat.plan.removeMarker" })}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              data-composer-collapse-priority="2"
              onClick={() => onSwitchMode("plan-off")}
              aria-label={intl.formatMessage({ id: "chat.plan.removeMarker" })}
              className="group/plan h-7 gap-1 rounded-lg px-2 text-ui-base text-foreground-subtle hover:text-foreground-subtle data-[composer-compact=true]:w-7 data-[composer-compact=true]:px-0"
            >
              <LightbulbIcon className="size-4 group-hover/plan:hidden group-focus-visible/plan:hidden" />
              <XIcon className="hidden size-4 group-hover/plan:block group-focus-visible/plan:block" />
              <span className="inline group-data-[composer-compact=true]/plan:hidden">
                {intl.formatMessage({ id: "mode.plan" })}
              </span>
            </Button>
          </ControlHintTooltip>
        </span>
      )}
    </div>
  );
}
export const V4ComposerModeSwitch = memo(V4ComposerModeSwitchImpl);
