/**
 * 「获取模型列表」的 IO 边界：按候选端点逐个尝试，只有端点不存在才继续下一个。
 *
 * 供应商鉴权头由调用方一次性构造（见 `provider-model-list.ts`），本文件不读取配置事实，
 * 也不缓存结果：设置页每次点击都重新拉取，避免模型列表成为第二份需要失效的状态。
 */
import {
  PROVIDER_LIST_MODELS_ENDPOINT_TIMEOUT_MS,
  type ShucodeProviderListModelsConnection,
} from "@shucode/shared";
import {
  MODEL_LIST_RETRYABLE_STATUS,
  ProviderModelListingError,
  buildProviderModelListCandidates,
  buildProviderModelListHeaders,
  classifyModelListStatus,
  parseProviderModelList,
  type ProviderModelListingError as ProviderModelListingErrorType,
} from "./provider-model-list.js";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export type ProviderModelListConnection = ShucodeProviderListModelsConnection;

export interface ProviderModelListSuccess {
  readonly endpoint: string;
  readonly models: readonly string[];
}

export interface ProviderModelListingDependencies {
  /** 测试注入点；生产使用全局 fetch（与 provider 配置下载同一约定）。 */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

function createRequestSignal(timeoutMs: number): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => clearTimeout(timer),
  };
}

async function readResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new ProviderModelListingError(
      `Provider model list response is too large (${declared} bytes).`,
      "invalid-response",
    );
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new ProviderModelListingError(
      "Provider model list response exceeds the size limit.",
      "invalid-response",
    );
  }
  return text;
}

async function requestModelList(input: {
  endpoint: string;
  headers: Readonly<Record<string, string>>;
  fetchImpl: typeof globalThis.fetch;
  timeoutMs: number;
}): Promise<readonly string[]> {
  const request = createRequestSignal(input.timeoutMs);
  let response: Response;
  try {
    response = await input.fetchImpl(input.endpoint, {
      method: "GET",
      headers: { ...input.headers },
      signal: request.signal,
      redirect: "follow",
    });
  } catch (error) {
    if (request.didTimeout()) {
      throw new ProviderModelListingError(
        `Provider model list request timed out after ${input.timeoutMs}ms: ${input.endpoint}`,
        "network",
      );
    }
    throw new ProviderModelListingError(
      `Provider model list request failed: ${error instanceof Error ? error.message : String(error)}`,
      "network",
    );
  } finally {
    request.dispose();
  }

  if (!response.ok) {
    const kind = classifyModelListStatus(response.status);
    throw new ProviderModelListingError(
      `Provider model list request returned HTTP ${response.status}: ${input.endpoint}`,
      kind,
      { status: response.status },
    );
  }

  const text = await readResponseText(response);
  if (!text.trim()) {
    return [];
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ProviderModelListingError(
      `Provider model list response is not JSON: ${input.endpoint}`,
      "invalid-response",
    );
  }
  return parseProviderModelList(payload);
}

/**
 * 依次尝试派生出的候选端点，返回第一个成功解析出模型的结果。
 *
 * 失败语义：
 * - 401/403：立即抛出（凭据问题换端点也不会成功）；
 * - 404/405：静默尝试下一个候选；
 * - 其它状态与网络错误：立即抛出，避免把真实故障伪装成「供应商不支持」；
 * - 全部候选都不存在：抛出 `endpoint-not-found`，提示用户检查 Base URL。
 */
export async function listProviderModels(
  connection: ProviderModelListConnection,
  dependencies: ProviderModelListingDependencies = {},
): Promise<ProviderModelListSuccess> {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ProviderModelListingError(
      "This runtime does not provide fetch() for provider model listing.",
      "network",
    );
  }

  const timeoutMs = dependencies.timeoutMs ?? PROVIDER_LIST_MODELS_ENDPOINT_TIMEOUT_MS;
  const candidates = buildProviderModelListCandidates(connection.baseUrl);
  const headers = buildProviderModelListHeaders({
    apiFormat: connection.apiFormat,
    ...(connection.apiKey === undefined ? {} : { apiKey: connection.apiKey }),
    ...(connection.headers === undefined ? {} : { headers: connection.headers }),
  });

  let lastRetryableError: ProviderModelListingErrorType | undefined;
  for (const endpoint of candidates) {
    try {
      const models = await requestModelList({ endpoint, headers, fetchImpl, timeoutMs });
      return { endpoint, models };
    } catch (error) {
      const listingError =
        error instanceof ProviderModelListingError
          ? error
          : new ProviderModelListingError(String(error), "network", { cause: error });
      // 只有明确的「端点不存在」才继续下一个候选；其余失败必须原样上报。
      if (
        listingError.status === undefined ||
        !MODEL_LIST_RETRYABLE_STATUS.has(listingError.status)
      ) {
        throw listingError;
      }
      lastRetryableError = listingError;
    }
  }

  throw (
    lastRetryableError ??
    new ProviderModelListingError("No candidate model list endpoint was available.", "network")
  );
}

export { ProviderModelListingError };
export type { ProviderModelListingErrorType };
