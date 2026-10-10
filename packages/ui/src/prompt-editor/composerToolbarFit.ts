const COLLAPSE_PRIORITIES = ["0", "1", "2", "3"];
const FIT_STEP_COUNT = 8;

export function getComposerToolbarLayoutStyleKey(style: CSSStyleDeclaration): string {
  const values: string[] = [];
  for (let index = 0; index < style.length; index++) {
    const name = style.item(index);
    // RollingToolbarLabel 的位移/淡入每帧变化，但不改变工具栏所需宽度。
    if (
      /^(transform|translate|scale|rotate|opacity|will-change|transition.*|animation.*)$/.test(name)
    )
      continue;
    values.push(`${name}:${style.getPropertyValue(name)}`);
  }
  return values.sort().join(";");
}

export function getComposerToolbarFitProjection(step: number) {
  return {
    compactPriorities: COLLAPSE_PRIORITIES.slice(0, Math.min(step, 4)),
    providerCompact: step >= 5,
    thoughtIcon: step >= 6,
    modelIcon: step >= 7,
  };
}

/** 尺寸缓存由单个 toolbar 实例持有；连续 resize 只选档，不重新触碰测量 DOM。 */
export function createComposerToolbarFitCache() {
  const widthsByContainer = new Map<string, readonly number[]>();
  return {
    invalidate() {
      widthsByContainer.clear();
    },
    select(width: number, containerKey: string, measure: () => readonly number[]) {
      if (!Number.isFinite(width) || width <= 0) return null;
      let widths = widthsByContainer.get(containerKey);
      if (!widths) {
        widths = measure();
        if (widths.length === 0) return null;
        widthsByContainer.set(containerKey, widths);
      }
      const step = widths.findIndex((required) => required <= width);
      return step === -1 ? widths.length - 1 : step;
    },
  };
}

function setProjectionAttribute(element: HTMLElement, key: string, value: string | undefined) {
  if (element.dataset[key] === value) return;
  if (value === undefined) delete element.dataset[key];
  else element.dataset[key] = value;
}

export function applyComposerToolbarFitProjection(root: HTMLElement, step: number) {
  const projection = getComposerToolbarFitProjection(step);
  setProjectionAttribute(root, "composerModelIcon", projection.modelIcon ? "true" : undefined);
  setProjectionAttribute(
    root,
    "composerProviderCompact",
    projection.providerCompact ? "true" : undefined,
  );
  for (const control of root.querySelectorAll<HTMLElement>("[data-composer-collapse-priority]")) {
    const isThought = control.hasAttribute("data-composer-thought-control");
    const compact = projection.compactPriorities.includes(
      control.dataset.composerCollapsePriority ?? "",
    );
    setProjectionAttribute(
      control,
      "composerCompact",
      isThought && projection.thoughtIcon ? "icon" : compact ? "true" : undefined,
    );
  }
}

/** 仅内容失效时批量写入所有档位，再统一读尺寸，避免逐档写属性/读几何强制重排。 */
export function measureComposerToolbarFitWidths(root: HTMLElement): readonly number[] {
  const parent = root.parentElement;
  if (!parent || !root.querySelector("[data-composer-leading-content]")) return [];
  const host = root.ownerDocument.createElement("div");
  host.dataset.composerToolbarMeasurement = "true";
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  Object.assign(host.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    contain: "layout style",
    width: "0",
    height: "0",
    left: "0",
    top: "0",
  });
  const probes = Array.from({ length: FIT_STEP_COUNT }, (_, step) => {
    const probe = root.cloneNode(true) as HTMLElement;
    probe.dataset.composerToolbarProbe = "true";
    probe.removeAttribute("id");
    probe.setAttribute("aria-hidden", "true");
    probe.inert = true;
    Object.assign(probe.style, {
      position: "absolute",
      width: "max-content",
      maxWidth: "none",
      left: "0",
      top: "0",
    });
    applyComposerToolbarFitProjection(probe, step);
    host.append(probe);
    return probe;
  });
  // 副本留在原父级，继承 Desktop/Web 字体、主题和 @container/composer 规则。
  parent.append(host);
  try {
    const view = root.ownerDocument.defaultView;
    const gap = Number.parseFloat(view?.getComputedStyle(probes[0]!).columnGap ?? "") || 12;
    return probes.map((probe) => {
      const content = probe.querySelector<HTMLElement>("[data-composer-leading-content]");
      const trailing = probe.querySelector<HTMLElement>("[data-composer-trailing-actions]");
      return (
        (content?.getBoundingClientRect().width ?? 0) +
        (trailing ? trailing.getBoundingClientRect().width + gap : 0)
      );
    });
  } finally {
    host.remove();
  }
}
