import type { ApiClient } from "@shucode/shared";
import type { ModelSelectionView } from "@shucode/provider";
import type { ICodingPlanSubscriptionService } from "./codingPlanSubscription.js";
import { BigModelCodingPlanSubscriptionProvider } from "./bigmodelCodingPlanSubscriptionProvider.js";

interface CodingPlanSubscriptionServiceDependencies {
  apiClient: ApiClient;
  resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
}

/**
 * 二开定制：原实现同时持有 bigmodel / zai 两个 provider，并按 request.family 路由
 * 企业定价读路径。套餐与企业定价链路已整体删除，只剩平台 `client/configs` 读取，
 * 因此装配收敛为单 provider，不再有 family 分支。
 */
export function createCodingPlanSubscriptionService(
  dependencies: CodingPlanSubscriptionServiceDependencies,
): ICodingPlanSubscriptionService {
  const provider = new BigModelCodingPlanSubscriptionProvider(dependencies);

  return {
    getOffPeakClientConfig: (options) => provider.getOffPeakClientConfig(options),
    getDynamicWorkflowClientConfig: (options) => provider.getDynamicWorkflowClientConfig(options),
  };
}
