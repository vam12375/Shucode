// renderer 的 window.shucode 全局声明：类型直接派生自 preload 实际暴露的桥对象
// （ShucodeBridge = typeof shucodeBridge），桥增删方法时两边同步、无需手写镜像。
// 注意：只允许在 Electron desktop renderer 中使用；Web 端经 packages/ui 的 hooks
// 走 IPlatformService，不直接触碰 window.shucode。
import type { ShucodeBridge } from "../../preload/index.js";

declare global {
  interface Window {
    shucode: ShucodeBridge;
  }
}

export {};
