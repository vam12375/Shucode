/* 二开定制：编程套餐 / 团队套餐 / Start Plan 状态卡与额度卡已全部下线，
 * 这里只保留自定义供应商详情在首屏加载时使用的 loading 占位卡。 */
import { Loader2Icon } from "lucide-react";

export function ModelProviderLoadingCard({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2 text-ui-base text-foreground-subtle">
        <Loader2Icon className="size-4 animate-spin" />
        <span>{loadingLabel}</span>
      </div>
    </div>
  );
}
