import type { IDisposable } from "@shucode/rpc";
import type { IShucodeAgentService } from "@shucode/services";
import { HostResponseTypes, type ProcessResourceRuntimeSurface } from "@shucode/shared";

export function registerHostToolExecResourceTelemetry(options: {
  agentService: Pick<IShucodeAgentService, "onDynamicToolExecResource">;
  postMessage(message: unknown): void;
  runtimeSurface: ProcessResourceRuntimeSurface;
}): IDisposable {
  return options.agentService.onDynamicToolExecResource()((sample) => {
    try {
      options.postMessage({
        type: HostResponseTypes.ToolExecResource,
        runtimeSurface: options.runtimeSurface,
        sample,
      });
    } catch {
      // main 退出或通道关闭只丢当前完成事实，不影响 Bash 生命周期。
    }
  });
}
