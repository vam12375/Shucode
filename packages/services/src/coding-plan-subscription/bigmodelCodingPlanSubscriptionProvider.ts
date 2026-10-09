/**
 * 二开定制：本文件原为「BigModel / Z.ai Coding Plan 订阅与购买」服务端读路径。
 * 官方订阅套餐 / 编程套餐 / Start Plan / 团队套餐 / 购买充值 / 订单支付整条链路已从
 * 代码中删除，只保留平台 `client/configs` 的读取能力，为两个**保留功能**提供灰度配置：
 *   1. 闲时任务（Off-Peak）：`configs.offPeak.enable_offpeak_task` + Registry 模型成员；
 *   2. 动态工作流灰度：`configs.dynamicWorkflow.mode`（本地 env 覆盖优先）。
 * 文件与类名沿用 `coding-plan-subscription` 通道的历史命名（通道名是 wire 契约），
 * 不代表这里仍存在套餐或购买语义。
 */
import type { ApiClient, ApiRequestInit } from "@shucode/shared";
import type { ModelSelectionView } from "@shucode/provider";
import type { OffPeakClientConfig } from "./codingPlanSubscription.js";
import {
  buildRuntimeShucodeApiUrl,
  createDynamicWorkflowClientConfig,
  DEFAULT_DYNAMIC_WORKFLOW_MODE,
  normalizeDynamicWorkflowMode,
  resolveDynamicWorkflowClientConfig,
  SHUCODE_DYNAMIC_WORKFLOW_MODE_ENV,
  SHUCODE_VERSION,
  type DynamicWorkflowClientConfig,
} from "@shucode/shared";
import { readApiJson } from "../providers/api/apiJson.js";
import { createServiceLogger } from "../logger/serviceLogger.js";

const SHUCODE_CLIENT_CONFIG_API_PREFIX = "/api/v1/client/configs";
const REQUEST_TIMEOUT_MS = 15_000;
const CLIENT_CONFIG_CACHE_TTL_MS = 60 * 60 * 1000;
/**
 * 平台接口偶发返回 WAF/HTML 页面或非 JSON 响应时使用的稳定错误码。
 * 二开已删除支付链路，这里只保留为 `client/configs` 读取失败的归一化错误，
 * 避免把整段 HTML 直接抛给调用方。
 */
const CODING_PLAN_SYSTEM_BUSY = "coding_plan_system_busy";
const log = createServiceLogger("codingPlanSubscription");

interface ShucodeClientConfigEnvelope {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: {
    configs?: {
      // 闲时任务灰度（服务端）：内层字段服务端为 snake_case，与外层 camelCase 混排。
      offPeak?: {
        enable_offpeak_task?: boolean;
      } | null;
      // 动态工作流灰度：mode 的取值域由
      // shared 的 normalizeDynamicWorkflowMode 裁决，这里保持 unknown，不在类型层假设服务端合法。
      dynamicWorkflow?: {
        mode?: unknown;
      } | null;
    } | null;
  } | null;
}

interface BigModelCodingPlanSubscriptionProviderOptions {
  apiClient: ApiClient;
  resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
}

export class BigModelCodingPlanSubscriptionProvider {
  protected readonly apiClient: ApiClient;
  private readonly resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
  private clientConfigSnapshot: ShucodeClientConfigEnvelope | null = null;
  private clientConfigSnapshotExpiresAt = 0;
  private clientConfigRequest: Promise<ShucodeClientConfigEnvelope> | null = null;

  constructor(options: BigModelCodingPlanSubscriptionProviderOptions) {
    this.apiClient = options.apiClient;
    this.resolveOffPeakModelSelectionView = options.resolveOffPeakModelSelectionView;
  }

  /**
   * 闲时任务灰度配置：复用 client/configs 通道零新增请求。
   * forceRefresh 供"打开 Automations 入口补拉"（1h 快照否则灰度翻转最长 1h 不可见）。
   */
  async getOffPeakClientConfig(options?: { forceRefresh?: boolean }): Promise<OffPeakClientConfig> {
    if (process.env["SHUCODE_OFFPEAK_MOCK"] === "1") {
      // mock 已经明确替代远端曝光配置，不能再先等待 /client/configs：
      // 离线 Desktop E2E 会一直停在 Loading，根本无法进入闲时执行链。
      const modelSelectionView = await this.resolveOffPeakModelSelectionView?.();
      return resolveOffPeakClientConfig({}, process.env, modelSelectionView);
    }
    if (options?.forceRefresh) {
      this.clientConfigSnapshot = null;
      this.clientConfigSnapshotExpiresAt = 0;
    }
    const payload = await this.getClientConfigs();
    const modelSelectionView = await this.resolveOffPeakModelSelectionView?.();
    return resolveOffPeakClientConfig(payload, process.env, modelSelectionView);
  }

  /**
   * 动态工作流灰度快照：与闲时任务同走
   * client/configs，零新增请求。三条边界：
   *   1. 本地覆盖（SHUCODE_DYNAMIC_WORKFLOW_MODE）在任何网络动作之前裁决，命中即返回——
   *      preview 构建和开发者手测因此不受 1h 快照与首次 Host 竞态影响；
   *   2. forceRefresh 与 Off-Peak 同义，清掉快照后重拉（灰度翻转最长 1h 不可见）；
   *   3. 请求失败 fail-closed：返回 default（disabled）并 warn，绝不把异常抛给调用方——
   *      调用方在 session create/client 就绪路径上，灰度读失败不能阻断普通聊天。
   */
  async getDynamicWorkflowClientConfig(options?: {
    forceRefresh?: boolean;
  }): Promise<DynamicWorkflowClientConfig> {
    // 覆盖合法即短路：判据（normalize）与快照构造（resolve）都留在 shared，这里不复述取值域。
    if (normalizeDynamicWorkflowMode(process.env[SHUCODE_DYNAMIC_WORKFLOW_MODE_ENV])) {
      return resolveDynamicWorkflowClientConfig({ remote: undefined, env: process.env });
    }
    if (options?.forceRefresh) {
      this.clientConfigSnapshot = null;
      this.clientConfigSnapshotExpiresAt = 0;
    }
    try {
      const payload = await this.getClientConfigs();
      return resolveDynamicWorkflowClientConfig({
        remote: payload.data?.configs?.dynamicWorkflow,
        env: process.env,
      });
    } catch (error) {
      log.warn(undefined, "动态工作流灰度配置读取失败，按关闭处理", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return createDynamicWorkflowClientConfig(DEFAULT_DYNAMIC_WORKFLOW_MODE, "default");
    }
  }

  private async getClientConfigs(): Promise<ShucodeClientConfigEnvelope> {
    if (this.clientConfigSnapshot && this.clientConfigSnapshotExpiresAt > Date.now()) {
      return this.clientConfigSnapshot;
    }
    if (this.clientConfigRequest) {
      return await this.clientConfigRequest;
    }

    // client/configs 和其他 Shucode 平台接口必须共享运行时 endpoint；
    // E2E/测试环境会通过 SHUCODE_BASE_URL 指向本地 mock，硬编码线上域名会让灰度配置不可控。
    const url = resolveCodingPlanClientConfigUrl(process.env);
    url.searchParams.set("app_version", SHUCODE_VERSION);
    url.searchParams.set("platform", resolveClientPlatformKey());
    // 闲时任务与动态工作流同屏读取时必须合并请求，避免未登录页面重复打远端配置。
    this.clientConfigRequest = readCodingPlanApiJson<ShucodeClientConfigEnvelope>(
      this.apiClient,
      url,
      {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
    );
    try {
      const payload = await this.clientConfigRequest;
      this.clientConfigSnapshot = payload;
      this.clientConfigSnapshotExpiresAt = Date.now() + CLIENT_CONFIG_CACHE_TTL_MS;
      return payload;
    } finally {
      this.clientConfigRequest = null;
    }
  }
}

function resolveCodingPlanClientConfigUrl(env: NodeJS.ProcessEnv): URL {
  return new URL(buildRuntimeShucodeApiUrl(env, SHUCODE_CLIENT_CONFIG_API_PREFIX));
}

/**
 * Z.ai 业务接口登录态鉴权头。
 *
 * 二开保留原因：`accountProviderTeamPlanRequestKey` 的 Team 运行时 key 投影仍按 family
 * 读取 Z.ai business JWT，这里保持与历史一致的 header 形状（业务 JWT 不能加 Bearer 前缀）。
 */
export function createZaiLoginAuthHeaders(token: string): Record<string, string> {
  return {
    // Z.ai provider connection 已把 access_token 持久化为业务 JWT。
    // 这里不能使用模型 API key，也不能给业务 JWT 添加 Bearer 前缀。
    Authorization: token,
    "Content-Type": "application/json",
  };
}

function resolveClientPlatformKey(): string {
  return `${process.platform}-${process.arch}`;
}

async function readCodingPlanApiJson<T>(
  apiClient: ApiClient,
  input: string | URL,
  init?: ApiRequestInit,
): Promise<T> {
  try {
    return await readApiJson<T>(apiClient, input, init);
  } catch (error) {
    const message = readRemoteErrorMessage(error);
    if (isUnrenderableRemoteErrorMessage(message)) {
      // 平台接口偶发返回 WAF/HTML 页面或非 JSON 响应，原样透传会把整段
      // HTML 渲到 UI。服务边界先收敛为稳定错误码，UI 再做本地化提示。
      throw new Error(CODING_PLAN_SYSTEM_BUSY);
    }
    throw error;
  }
}

function readRemoteErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error);
}

function isUnrenderableRemoteErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("<!doctype") ||
    /<\s*(html|head|body|script|style|title|meta)\b/.test(normalized) ||
    normalized.includes("errors.aliyun.com") ||
    normalized.includes("request has been blocked") ||
    normalized.includes("unexpected token '<'") ||
    normalized.includes("unexpected end of json input") ||
    normalized.includes("invalid json response")
  );
}

/**
 * 闲时任务灰度判据（纯函数供单测）：远端只提供曝光开关，模型成员和事实
 * 来自 Shucode Built-in Provider / Model Config。
 * mock 模式（SHUCODE_OFFPEAK_MOCK=1）只替代产品曝光；模型候选仍来自 Registry。
 */
export function resolveOffPeakClientConfig(
  payload: ShucodeClientConfigEnvelope,
  env: NodeJS.ProcessEnv,
  modelSelectionView: ModelSelectionView = EMPTY_OFF_PEAK_MODEL_SELECTION_VIEW,
): OffPeakClientConfig {
  const hasModels = modelSelectionView.providers.some((provider) => provider.models.length > 0);
  if (env["SHUCODE_OFFPEAK_MOCK"] === "1") {
    return {
      enabled: hasModels,
      modelSelectionView,
      // SHUCODE_OFFPEAK_MOCK_NO_PLAN=1 演示「非 coding plan 锁定」态；缺省视为已订阅。
      codingPlanActive: env["SHUCODE_OFFPEAK_MOCK_NO_PLAN"] !== "1",
    };
  }
  const raw = payload.data?.configs?.offPeak;
  return {
    enabled: raw?.enable_offpeak_task === true && hasModels,
    modelSelectionView,
  };
}

const EMPTY_OFF_PEAK_MODEL_SELECTION_VIEW: ModelSelectionView = Object.freeze({
  revision: 0,
  providers: Object.freeze([]),
});
