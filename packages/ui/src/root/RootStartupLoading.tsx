import type { ReactNode } from "react";
import shucodeLogoUrl from "@/assets/shucode-logo.png";
import { cn } from "@/components/lib/utils.js";

interface RootStartupLoadingProps {
  label: string;
  children?: ReactNode;
  busy?: boolean;
}

export function RootStartupLoading({ label, children, busy = true }: RootStartupLoadingProps) {
  return (
    <div
      // Web 端全局 html/body/#root 为 Electron 透明背景让路，React 接管后会替换 HTML 启动壳。
      // 这里必须由阻塞态自身承接主题背景，否则远控链接会在 Root 恢复期间继续露出浏览器白底。
      className="flex h-full min-h-dvh flex-col items-center justify-center gap-6 bg-background text-foreground"
      role="status"
      aria-busy={busy}
      aria-label={label}
      data-testid="root-startup-loading"
    >
      <ShucodeStartupLogoBadge />
      {children}
    </div>
  );
}

/** 初始化与引导共用品牌图标，保持圆角、比例与投影一致。 */
export function ShucodeStartupLogoBadge({ animated = true }: { animated?: boolean }) {
  return (
    <div className="relative flex size-24 items-center justify-center rounded-3xl shadow-xl/20">
      <ShucodeStartupLogo className="size-24 rounded-3xl" animated={animated} />
    </div>
  );
}

function ShucodeStartupLogo({
  className,
  animated = true,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    // 品牌 Logo 自带红底与圆角，容器不再叠加深色底与描边；动画沿用「延迟后轻微呼吸」的观感。
    <img
      src={shucodeLogoUrl}
      alt=""
      aria-hidden="true"
      className={cn(
        "shrink-0 object-contain",
        animated && "motion-safe:animate-pulse [animation-delay:3s]",
        className,
      )}
    />
  );
}
