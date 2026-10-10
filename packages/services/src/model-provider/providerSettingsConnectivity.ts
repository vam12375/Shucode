import type { ModelConnectivityResult, ShucodeProviderListModelsConnection } from "@shucode/shared";
import type {
  ProviderModelListingExecutor,
  ProviderSettingsConnectivityTester,
} from "./providerFacadeServices.js";

interface FormalModelConnectivityInput {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly selection: {
    readonly providerId: string;
    readonly modelId: string;
  };
}

interface FormalModelListingInput {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly providerId: string;
  readonly connection: ShucodeProviderListModelsConnection;
}

type FormalModelConnectivityExecutor = (
  input: FormalModelConnectivityInput,
) => Promise<{ readonly success: true }>;

type FormalModelListingExecutor = (
  input: FormalModelListingInput,
) => Promise<{ readonly endpoint: string; readonly models: readonly string[] }>;

/**
 * 设置页只负责把已经落盘并进入 Registry 的 ModelSelection 交给目标 Environment。
 * Provider 鉴权、headers、reasoning 映射和流消费全部由正式 Model 执行链负责。
 */
export function createProviderSettingsConnectivityTester(dependencies: {
  readonly testModelConnectivity: FormalModelConnectivityExecutor;
}): ProviderSettingsConnectivityTester {
  return async (input) => {
    try {
      await dependencies.testModelConnectivity({
        workspacePath: input.workspacePath,
        ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
        selection: {
          providerId: input.providerId,
          modelId: input.modelId,
        },
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  };
}

export type { ModelConnectivityResult };

/**
 * 模型发现只做「把设置页的连接草稿转成一次 Agent 请求」：
 * 候选端点派生、鉴权头构造与响应解析都在 Agent 进程，设置层不复制一份供应商协议知识。
 */
export function createProviderSettingsModelLister(dependencies: {
  readonly listProviderModels: FormalModelListingExecutor;
}): ProviderModelListingExecutor {
  return async (input) => {
    try {
      const result = await dependencies.listProviderModels({
        workspacePath: input.workspacePath,
        ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
        providerId: input.providerId,
        connection: input.connection,
      });
      return {
        success: true,
        endpoint: result.endpoint,
        models: [...result.models],
      };
    } catch (error) {
      return {
        success: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  };
}
