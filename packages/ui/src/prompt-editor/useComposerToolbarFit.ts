import { useLayoutEffect, useRef } from "react";
import {
  applyComposerToolbarFitProjection,
  createComposerToolbarFitCache,
  getComposerToolbarLayoutStyleKey,
  measureComposerToolbarFitWidths,
} from "@/prompt-editor/composerToolbarFit.js";

// Tailwind 当前 container token；只收集真实 toolbar 使用的命名断点。
const CONTAINER_BREAKPOINTS_REM: Record<string, number> = {
  xs: 20,
  sm: 24,
  md: 28,
  lg: 32,
  xl: 36,
  "2xl": 42,
  "3xl": 48,
  "4xl": 56,
  "5xl": 64,
  "6xl": 72,
  "7xl": 80,
};

function readContainerBreakpoints(root: HTMLElement): number[] {
  const names = new Set<string>();
  for (const element of [root, ...root.querySelectorAll<HTMLElement>("[class]")]) {
    for (const match of element.getAttribute("class")?.matchAll(/@(\w+)\/composer:/g) ?? []) {
      const name = match[1];
      if (name && name in CONTAINER_BREAKPOINTS_REM) names.add(name);
    }
  }
  const style = root.ownerDocument.defaultView?.getComputedStyle(
    root.ownerDocument.documentElement,
  );
  const rem = Number.parseFloat(style?.fontSize ?? "") || 16;
  return [...names].map((name) => {
    const token = style?.getPropertyValue(`--container-${name}`).trim();
    return token?.endsWith("px")
      ? Number.parseFloat(token)
      : (Number.parseFloat(token ?? "") || CONTAINER_BREAKPOINTS_REM[name]!) * rem;
  });
}

function readFontEnvironment(ancestors: readonly HTMLElement[]): string {
  return ancestors
    .map((element) => {
      const classes = [...element.classList].filter((name) =>
        /^(dark|theme-|font-|text-ui-|pk-|shucode-platform)/.test(name),
      );
      // Panel 的宽度动画 class/style 不是字体失效；只追踪实际继承的排版输入。
      return [
        classes.join(" "),
        element.style.getPropertyValue("--ui-font-size"),
        element.style.font,
        element.style.fontFamily,
        element.style.fontSize,
        element.style.fontWeight,
        element.style.letterSpacing,
      ].join(":");
    })
    .join("|");
}

/** 仅拥有 DOM 布局投影与实例内尺寸缓存；权限、Plan 和 CUA 仍由原有 hooks 管理。 */
export function useComposerToolbarFit() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const view = root.ownerDocument.defaultView;
    if (!view) return;
    const cache = createComposerToolbarFitCache();
    const container = root.closest<HTMLElement>('[class~="@container/composer"]');
    const ancestors: HTMLElement[] = [];
    for (let element = root.parentElement; element; element = element.parentElement)
      ancestors.push(element);
    let fontEnvironment = readFontEnvironment(ancestors);
    let breakpoints = readContainerBreakpoints(root);
    let width = root.getBoundingClientRect().width;
    let containerWidth = container?.clientWidth ?? width;
    let pendingFrame: number | null = null;
    let disposed = false;

    const update = () => {
      if (disposed || !root.isConnected) return;
      const containerKey = breakpoints.map((breakpoint) => containerWidth >= breakpoint).join(":");
      const step = cache.select(width, containerKey, () => measureComposerToolbarFitWidths(root));
      if (step !== null) applyComposerToolbarFitProjection(root, step);
    };
    const invalidate = () => {
      cache.invalidate();
      if (pendingFrame !== null || disposed) return;
      pendingFrame = view.requestAnimationFrame(() => {
        pendingFrame = null;
        if (disposed || !root.isConnected) return;
        // 内容失效可能同时隐藏/重挂 toolbar；旧 RO 宽度不能用于测量隐藏副本。
        // 只有此失效路径读取一次几何，连续宽度通知始终复用 observer 提供的数值。
        width = root.getBoundingClientRect().width;
        containerWidth = container?.clientWidth ?? width;
        if (width <= 0) return;
        breakpoints = readContainerBreakpoints(root);
        update();
      });
    };
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            // 同批先记录 root/container 的事实，选档过程不再读取活动 DOM 几何。
            for (const entry of entries) {
              if (entry.target === root) width = entry.contentRect.width;
              if (entry.target === container) containerWidth = entry.contentRect.width;
            }
            update();
          });
    resize?.observe(root);
    if (container && container !== root) resize?.observe(container);
    const handleWindowResize = () => {
      width = root.getBoundingClientRect().width;
      containerWidth = container?.clientWidth ?? width;
      update();
    };
    if (!resize) view.addEventListener("resize", handleWindowResize);

    // 布局投影属性自身不属于内容；避免写 compact 后使缓存递归失效。
    const layoutStyleKeys = new WeakMap<Element, string>();
    for (const element of [root, ...root.querySelectorAll<HTMLElement>("[style]")]) {
      layoutStyleKeys.set(element, getComposerToolbarLayoutStyleKey(element.style));
    }
    const mutations = new MutationObserver((records) => {
      let changed = false;
      for (const record of records) {
        if (record.type === "attributes" && record.attributeName === "style") {
          const element = record.target as HTMLElement;
          const next = getComposerToolbarLayoutStyleKey(element.style);
          if ((layoutStyleKeys.get(element) ?? "") !== next) changed = true;
          layoutStyleKeys.set(element, next);
        } else changed = true;
      }
      if (changed) invalidate();
    });
    mutations.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-composer-collapse-priority"],
    });
    const fontMutations = new MutationObserver(() => {
      const next = readFontEnvironment(ancestors);
      if (next === fontEnvironment) return;
      fontEnvironment = next;
      invalidate();
    });
    for (const ancestor of ancestors)
      fontMutations.observe(ancestor, { attributes: true, attributeFilter: ["class", "style"] });
    const fonts = root.ownerDocument.fonts;
    fonts?.addEventListener("loadingdone", invalidate);
    fonts?.addEventListener("loadingerror", invalidate);
    update();
    return () => {
      disposed = true;
      if (pendingFrame !== null) view.cancelAnimationFrame(pendingFrame);
      resize?.disconnect();
      mutations.disconnect();
      fontMutations.disconnect();
      fonts?.removeEventListener("loadingdone", invalidate);
      fonts?.removeEventListener("loadingerror", invalidate);
      view.removeEventListener("resize", handleWindowResize);
    };
  }, []);
  return ref;
}
