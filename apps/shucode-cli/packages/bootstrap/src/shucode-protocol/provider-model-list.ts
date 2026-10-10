/**
 * 供应商模型发现（「获取模型列表」）的纯逻辑：候选端点派生、鉴权头构造与响应解析。
 *
 * 这里只做供应商无关的规范化，不发请求：`provider-model-listing.ts` 负责 IO，本文件可单测。
 * 语义对齐设置页的既有约定——API Key 只用于本次请求的鉴权头，不写入任何配置事实。
 */

/** 与 CC Switch 一致：命中已知 Anthropic 兼容后缀时同时尝试剥掉后缀的根端点。
 * 例：DeepSeek 的 `/anthropic` 兼容层下没有 `/models`，模型列表挂在根上。 */
const KNOWN_COMPAT_SUFFIXES = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude",
] as const;

/** 只有「端点不存在」才继续试下一个候选；401/403/5xx 等要立即报给用户。 */
export const MODEL_LIST_RETRYABLE_STATUS = new Set([404, 405]);

export type ProviderModelListingErrorKind =
  | "invalid-connection"
  | "unauthorized"
  | "endpoint-not-found"
  | "http-error"
  | "invalid-response"
  | "network";

export class ProviderModelListingError extends Error {
  /** HTTP 状态码。流程判断只读这里，不解析 message 文本。 */
  readonly status?: number;

  constructor(
    message: string,
    readonly kind: ProviderModelListingErrorKind,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderModelListingError";
    this.status = options.status;
  }
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function endsWithVersionSegment(pathname: string): boolean {
  return /\/v\d+$/.test(pathname);
}

/**
 * 兼容后缀必须落在完整路径段边界上：`/api/anthropic` 命中，`/api/anthropic-proxy` 不命中。
 * 否则会把 `…/anthropic/v1` 也当成 `/anthropic` 后缀，剥出错误的根路径。
 */
function stripKnownCompatSuffix(pathname: string): string | undefined {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (!pathname.endsWith(suffix)) continue;
    const boundary = pathname.length - suffix.length;
    if (boundary === 0 || pathname[boundary - 1] === "/") {
      return pathname.slice(0, boundary);
    }
  }
  return undefined;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * 派生候选模型列表端点。顺序即尝试顺序：
 * 1. base 以版本段结尾（`/v1`、`/api/coding/paas/v4`）→ `{base}/models`；
 * 2. base 不是 `/v1` 时 → `{base}/v1/models`；
 * 3. base 没有版本段时补 `{base}/models` 兜底；
 * 4. 命中已知兼容后缀时，剥掉后缀再试 `{root}/v1/models` 与 `{root}/models`
 *    （DeepSeek 的 `/anthropic` 兼容层下没有 `/models`，列表挂在根上）。
 *
 * 结果按首次出现顺序去重；只有 404/405 才会继续尝试下一个候选。
 */
export function buildProviderModelListCandidates(baseUrl: string): string[] {
  const trimmed = stripTrailingSlashes(baseUrl.trim());
  if (!trimmed) {
    throw new ProviderModelListingError("Provider base URL is empty.", "invalid-connection");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ProviderModelListingError(
      `Provider base URL is not a valid URL: ${baseUrl}`,
      "invalid-connection",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProviderModelListingError(
      `Provider base URL must use http(s): ${baseUrl}`,
      "invalid-connection",
    );
  }

  const pathname = stripTrailingSlashes(parsed.pathname);
  const candidates: string[] = [];
  // 已经是 `/v1` 时不再拼一遍，否则会退化成 `/v1/v1/models`；其余情况都保留 `/models` 兜底
  // （部分供应商把模型列表挂在站点根，例如 DeepSeek）。
  if (endsWithVersionSegment(pathname)) {
    candidates.push(`${trimmed}/models`);
  }
  if (!pathname.endsWith("/v1")) {
    candidates.push(`${trimmed}/v1/models`);
  }
  if (!endsWithVersionSegment(pathname)) {
    candidates.push(`${trimmed}/models`);
  }

  const rootPath = stripKnownCompatSuffix(pathname);
  if (rootPath !== undefined) {
    const root = `${parsed.origin}${rootPath}`;
    candidates.push(`${root}/v1/models`, `${root}/models`);
  }

  return unique(candidates);
}

/** 单条自定义头的合法性与大小上限：避免把换行或超大值写进外发请求。 */
const MAX_CUSTOM_HEADER_COUNT = 64;
const MAX_CUSTOM_HEADER_NAME_LENGTH = 256;
const MAX_CUSTOM_HEADER_VALUE_LENGTH = 16 * 1024;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function isSafeHeaderName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_CUSTOM_HEADER_NAME_LENGTH &&
    HEADER_NAME_PATTERN.test(name)
  );
}

function isSafeHeaderValue(value: string): boolean {
  // 头值不能含 CR/LF：否则自定义头可以拆出额外请求头。
  return value.length <= MAX_CUSTOM_HEADER_VALUE_LENGTH && !/[\r\n]/.test(value);
}

/**
 * 构造模型列表请求头。鉴权头形态由 API 格式决定；Provider 自定义头只做补充，
 * 不能用来覆盖已经确定的鉴权头，避免表单里的历史配置把凭据写成另一种形式。
 */
export function buildProviderModelListHeaders(input: {
  apiFormat: "anthropic-messages" | "openai-chat-completions" | "openai-responses";
  apiKey?: string;
  headers?: Readonly<Record<string, string>>;
}): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    if (input.apiFormat === "anthropic-messages") {
      headers["x-api-key"] = apiKey;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }

  const entries = Object.entries(input.headers ?? {});
  if (entries.length > MAX_CUSTOM_HEADER_COUNT) {
    throw new ProviderModelListingError(
      `Provider declares too many custom headers (${entries.length}).`,
      "invalid-connection",
    );
  }
  for (const [name, value] of entries) {
    if (!isSafeHeaderName(name) || !isSafeHeaderValue(value)) {
      throw new ProviderModelListingError(
        `Provider custom header is invalid: ${name}`,
        "invalid-connection",
      );
    }
    const normalized = name.toLowerCase();
    if (normalized === "authorization" || normalized === "x-api-key") {
      // 鉴权头只由上面的 API Key 逻辑决定，自定义头不得改写它。
      continue;
    }
    headers[name] = value;
  }

  return headers;
}

function readModelId(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return entry.trim() || undefined;
  }
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  // 智谱等 OpenAI Responses 兼容端用 `slug`；OpenAI/Anthropic 用 `id`。
  // 两个字段同时存在时以 `slug` 为准，与 CC Switch 的选择顺序一致。
  for (const key of ["slug", "id", "name", "model"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readModelIds(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null
      ? Object.keys(value as Record<string, unknown>)
      : [];
  return list.flatMap((entry) => {
    const id = readModelId(entry);
    return id ? [id] : [];
  });
}

/**
 * 解析模型列表响应。兼容 `{data:[{id}]}`（OpenAI / Anthropic）、`{models:[{slug|id}]}`
 * （OpenAI Responses 兼容）与顶层数组；无法识别的结构返回空数组，由调用方按
 * 「该供应商不支持」报错，而不是把解析失败伪装成没有模型。
 */
export function parseProviderModelList(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return sortModelIds(readModelIds(payload));
  }
  if (typeof payload !== "object" || payload === null) {
    throw new ProviderModelListingError(
      "Provider model list response is not a JSON object or array.",
      "invalid-response",
    );
  }

  const record = payload as Record<string, unknown>;
  const data = record.data;
  if (Array.isArray(data)) {
    return sortModelIds(readModelIds(data));
  }
  if (data !== undefined && data !== null) {
    throw new ProviderModelListingError(
      "Provider model list response has an unsupported `data` shape.",
      "invalid-response",
    );
  }

  const models = record.models;
  if (models !== undefined && models !== null) {
    if (Array.isArray(models) || typeof models === "object") {
      return sortModelIds(readModelIds(models));
    }
    throw new ProviderModelListingError(
      "Provider model list response has an unsupported `models` shape.",
      "invalid-response",
    );
  }

  return [];
}

function sortModelIds(ids: readonly string[]): string[] {
  return unique(ids).sort((left, right) => left.localeCompare(right));
}

/** 把 HTTP 状态码翻译成用户可理解的类别；设置页据此给不同文案。 */
export function classifyModelListStatus(status: number): ProviderModelListingErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404 || status === 405) return "endpoint-not-found";
  return "http-error";
}
