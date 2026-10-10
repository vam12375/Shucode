/** 内容列与整轮 wrapper 同宽，测量事实由当前 Timeline 实例保存。 */
export class TimelineContentWidthTracker {
  private observedWidthPx: number | null = null;
  private stableWidthPx: number | null = null;

  reset(widthPx: number): void {
    const width = this.normalizeWidth(widthPx);
    this.observedWidthPx = width;
    this.stableWidthPx = width;
  }

  observe(widthPx: number): void {
    const width = this.normalizeWidth(widthPx);
    if (width === null) return;
    this.observedWidthPx = width;
    this.stableWidthPx ??= width;
  }

  isChanging(): boolean {
    return this.observedWidthPx !== this.stableWidthPx;
  }

  settle(): void {
    this.stableWidthPx = this.observedWidthPx;
  }

  private normalizeWidth(widthPx: number): number | null {
    return Number.isFinite(widthPx) && widthPx >= 0 ? Math.round(widthPx) : null;
  }
}
