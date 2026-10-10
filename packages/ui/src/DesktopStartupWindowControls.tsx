import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DesktopWindowControls } from "./DesktopWindowControls.js";

function findStartupControlsTarget(enabled: boolean): HTMLElement | null {
  if (!enabled || typeof document === "undefined") return null;
  return document.getElementById("splash-window-controls");
}

export function DesktopStartupWindowControls({ enabled }: { enabled: boolean }) {
  const [target, setTarget] = useState(() => findStartupControlsTarget(enabled));

  useEffect(() => {
    const container = findStartupControlsTarget(enabled);
    setTarget(container);
    const splash = container?.parentElement;
    const parent = splash?.parentElement;
    if (!container || !splash || !parent) return;

    // 启动壳盖住了普通首屏的自绘窗控；只复用同一组件，退场仍由 HTML 唯一所有者决定。
    const observer = new MutationObserver(() => {
      if (container.isConnected && splash.isConnected) return;
      setTarget(null);
      observer.disconnect();
    });
    observer.observe(splash, { childList: true });
    observer.observe(parent, { childList: true });
    return () => observer.disconnect();
  }, [enabled]);

  if (!enabled || !target) return null;

  return createPortal(
    <div
      data-testid="desktop-startup-window-controls"
      className="flex h-full items-center [app-region:no-drag]"
    >
      <DesktopWindowControls />
    </div>,
    target,
  );
}
