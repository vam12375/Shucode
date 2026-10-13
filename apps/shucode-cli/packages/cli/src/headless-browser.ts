import {
  createManagedCdpBrowserRuntime,
  type ManagedCdpBrowserRuntime,
  type PlaywrightChromiumModule,
} from "@shucode/adapters/browser";
import type { GlobalOptions } from "@shucode/shared-types";
import type { RunDependencies } from "./cli-types.js";

export function createCliHeadlessBrowserRuntime(
  options: Pick<GlobalOptions, "browserExecutable" | "browserUse">,
  deps: RunDependencies,
): ManagedCdpBrowserRuntime | undefined {
  if (options.browserUse !== "headless") return undefined;
  const factory = deps.createManagedCdpBrowserRuntime ?? createManagedCdpBrowserRuntime;
  return factory({
    env: deps.env,
    executablePath: options.browserExecutable,
    // managed headless adapter 只在显式 --browser-use=headless 时延迟加载 playwright-core。
    loadPlaywright: async () => (await import("playwright-core")) as PlaywrightChromiumModule,
  });
}
