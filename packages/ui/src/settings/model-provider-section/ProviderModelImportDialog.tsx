/**
 * 「获取模型列表」的导入弹窗：展示供应商返回的模型 ID，用户勾选后再批量加入模型列表。
 *
 * 拉取结果只活在本组件的局部状态里：它不是配置事实，取消弹窗即丢弃，不写 store、
 * 不落盘，也不缓存——下次点击重新拉取，避免出现第二份需要失效的模型列表。
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";

export interface ProviderModelImportDialogProps {
  open: boolean;
  /** 供应商返回的全部模型 ID；已存在于模型列表的会被标记并禁止重复勾选。 */
  fetchedModels: readonly string[];
  /** 实际命中的候选端点，用于告诉用户「从哪里拉到的」。 */
  endpoint?: string;
  /** 当前供应商已有的模型 ID，用于标记「已添加」。 */
  existingModelIds: readonly string[];
  importing: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (modelIds: readonly string[]) => void | Promise<void>;
}

export function ProviderModelImportDialog({
  open,
  fetchedModels,
  endpoint,
  existingModelIds,
  importing,
  onOpenChange,
  onImport,
}: ProviderModelImportDialogProps) {
  const { intl } = useShucodeIntl();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const existing = useMemo(() => new Set(existingModelIds), [existingModelIds]);
  const candidates = useMemo(
    () => fetchedModels.filter((modelId) => !existing.has(modelId)),
    [existing, fetchedModels],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      normalizedQuery
        ? fetchedModels.filter((modelId) => modelId.toLowerCase().includes(normalizedQuery))
        : fetchedModels,
    [fetchedModels, normalizedQuery],
  );

  // 每次打开都以「全选尚未添加的模型」为初始状态：这是用户点「获取模型列表」的默认意图。
  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected(new Set());
      return;
    }
    setQuery("");
    setSelected(new Set(candidates));
  }, [candidates, open]);

  const toggle = (modelId: string) => {
    if (existing.has(modelId)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const selectedCount = candidates.filter((modelId) => selected.has(modelId)).length;
  const allVisibleSelected =
    visible.length > 0 &&
    visible.every((modelId) => existing.has(modelId) || selected.has(modelId));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 导入进行中不允许关闭：批量写入需要以实际保存结果作为结束边界。
        if (importing) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="pk-provider-model-import-dialog max-w-lg"
        data-testid="model-provider-import-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: "settings.modelProvider.fetchModels.title" })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage(
              { id: "settings.modelProvider.fetchModels.description" },
              { count: fetchedModels.length },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-3">
          <Input
            type="search"
            size="lg"
            value={query}
            data-testid="model-provider-import-search"
            placeholder={intl.formatMessage({
              id: "settings.modelProvider.fetchModels.searchPlaceholder",
            })}
            onChange={(event) => setQuery(event.target.value)}
          />

          <div className="flex items-center justify-between gap-2 text-ui-sm text-foreground-subtle">
            <span data-testid="model-provider-import-summary">
              {intl.formatMessage(
                { id: "settings.modelProvider.fetchModels.selected" },
                { selected: selectedCount, total: candidates.length },
              )}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={visible.length === 0}
              onClick={() => {
                setSelected((current) => {
                  const next = new Set(current);
                  for (const modelId of visible) {
                    if (existing.has(modelId)) continue;
                    if (allVisibleSelected) {
                      next.delete(modelId);
                    } else {
                      next.add(modelId);
                    }
                  }
                  return next;
                });
              }}
            >
              {intl.formatMessage({
                id: allVisibleSelected
                  ? "settings.modelProvider.fetchModels.clearSelection"
                  : "settings.modelProvider.fetchModels.selectAll",
              })}
            </Button>
          </div>

          {visible.length > 0 ? (
            <div
              className="max-h-72 overflow-y-auto rounded-lg border border-input-border bg-input p-1"
              data-testid="model-provider-import-list"
            >
              {visible.map((modelId) => {
                const alreadyAdded = existing.has(modelId);
                const checked = alreadyAdded || selected.has(modelId);
                return (
                  <label
                    key={modelId}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-ui-base hover:bg-surface-hover",
                      alreadyAdded && "cursor-default opacity-60",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={alreadyAdded || importing}
                      aria-label={modelId}
                      onCheckedChange={() => toggle(modelId)}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono">{modelId}</span>
                    {alreadyAdded ? (
                      <span className="shrink-0 text-ui-sm text-foreground-subtle">
                        {intl.formatMessage({
                          id: "settings.modelProvider.fetchModels.alreadyAdded",
                        })}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          ) : (
            <div
              className="flex h-16 items-center justify-center rounded-lg border border-dashed border-border text-ui-base text-foreground-subtle"
              data-testid="model-provider-import-empty"
            >
              {intl.formatMessage({
                id:
                  fetchedModels.length === 0
                    ? "settings.modelProvider.fetchModels.noModels"
                    : "settings.modelProvider.fetchModels.noMatch",
              })}
            </div>
          )}

          {endpoint ? (
            <p className="truncate text-ui-sm text-foreground-subtle" title={endpoint}>
              {intl.formatMessage(
                { id: "settings.modelProvider.fetchModels.endpoint" },
                { endpoint },
              )}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={importing}
            onClick={() => onOpenChange(false)}
          >
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
          <Button
            type="button"
            data-testid="model-provider-import-confirm"
            disabled={importing || selectedCount === 0}
            onClick={() => {
              void onImport(candidates.filter((modelId) => selected.has(modelId)));
            }}
          >
            {importing ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
            {intl.formatMessage(
              { id: "settings.modelProvider.fetchModels.import" },
              { count: selectedCount },
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
