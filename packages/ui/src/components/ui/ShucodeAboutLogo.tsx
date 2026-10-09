import shucodeLogoUrl from "@/assets/shucode-logo.png";
import { cn } from "@/components/lib/utils.js";

/** 品牌主标：红底像素厨师鼠（与桌面图标、站点 logo 同源）。 */
export function ShucodeAboutLogo({ className }: { className?: string }) {
  return (
    <img
      src={shucodeLogoUrl}
      alt=""
      aria-hidden="true"
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

/** 横排商标：主标 + Shucode 文字，用于需要完整品牌名的位置。 */
export function ShucodeWordmarkLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-[0.4em]", className)}>
      <img
        src={shucodeLogoUrl}
        alt=""
        aria-hidden="true"
        className="h-[1.6em] w-[1.6em] object-contain"
      />
      <span className="text-[1.15em] font-semibold tracking-tight">Shucode</span>
    </span>
  );
}
