/** Instrument browser APIs, rather than importing or duplicating the fit implementation. */
export function installResizeMetrics() {
  const metrics = {
    clones: 0,
    probes: 0,
    pendingHookRafs: 0,
    detachedHookRafs: 0,
    resizeObservers: 0,
    mutationObservers: 0,
  };
  window.resizeMetrics = metrics;
  const isToolbar = (node) =>
    node instanceof Element && node.getAttribute("data-testid") === "composer-toolbar";
  const cloneNode = Node.prototype.cloneNode;
  Node.prototype.cloneNode = function (...args) {
    if (isToolbar(this)) metrics.clones += 1;
    return cloneNode.apply(this, args);
  };
  const countProbe = (node) => {
    if (isToolbar(node) && node.getAttribute("aria-hidden") === "true") metrics.probes += 1;
  };
  const append = Element.prototype.append;
  Element.prototype.append = function (...nodes) {
    nodes.forEach(countProbe);
    return append.apply(this, nodes);
  };
  const appendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function (node) {
    countProbe(node);
    return appendChild.call(this, node);
  };
  for (const [name, metric] of [
    ["ResizeObserver", "resizeObservers"],
    ["MutationObserver", "mutationObservers"],
  ]) {
    const NativeObserver = window[name];
    if (!NativeObserver) continue;
    window[name] = class extends NativeObserver {
      tracked = false;
      fromHook = new Error().stack?.includes("useComposerToolbarFit") ?? false;
      observe(node, options) {
        if (!this.tracked && this.fromHook) {
          this.tracked = true;
          metrics[metric] += 1;
        }
        return super.observe(node, options);
      }
      disconnect() {
        if (this.tracked) metrics[metric] -= 1;
        this.tracked = false;
        return super.disconnect();
      }
    };
  }
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  const hookRafs = new Set();
  window.requestAnimationFrame = (callback) => {
    const tracked = new Error().stack?.includes("useComposerToolbarFit") ?? false;
    const id = request((time) => {
      if (hookRafs.delete(id)) {
        metrics.pendingHookRafs -= 1;
        if (!document.querySelector('[data-testid="composer-toolbar"]'))
          metrics.detachedHookRafs += 1;
      }
      callback(time);
    });
    if (tracked) {
      hookRafs.add(id);
      metrics.pendingHookRafs += 1;
    }
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    if (hookRafs.delete(id)) metrics.pendingHookRafs -= 1;
    cancel(id);
  };
}
