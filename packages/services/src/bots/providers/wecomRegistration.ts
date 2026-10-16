import { fetchBotProviderJson } from "./providerRequest.js";

/**
 * 企业微信扫码创建智能机器人。官方没有公开这套接口的文档，协议取自企业微信官方
 * OpenClaw 插件 CLI（@wecom/wecom-openclaw-cli 的 qrcode 流程），三个端点均已实测可用：
 * 取码 → 扫码 → 轮询，扫码成功后直接返回 BotID 与 Secret。
 * 因为未公开文档化，端点和参数集中在本文件，失败时由调用方给出可读提示并退回到手动录入。
 */
const WECOM_QR_REQUEST_SOURCE = "shucode";
const WECOM_QR_GENERATE_URL = "https://work.weixin.qq.com/ai/qc/generate";
const WECOM_QR_QUERY_URL = "https://work.weixin.qq.com/ai/qc/query_result";
const WECOM_QR_PAGE_URL = "https://work.weixin.qq.com/ai/qc/gen";
const WECOM_QR_LOGIN_INTERVAL_SECONDS = 3;
// 官方 CLI 的轮询总时长为 5 分钟；超过后二维码不再有效，必须重新取码。
const WECOM_QR_LOGIN_EXPIRE_SECONDS = 300;
const WECOM_QR_REQUEST_TIMEOUT_MS = 15_000;

export interface WeComRegistrationBeginResult {
  scode: string;
  authUrl: string;
  /** 浏览器兜底入口：终端或桌面端不便扫码时可直接打开。 */
  pageUrl: string;
  interval: number;
  expiresAt: number;
}

export interface WeComRegistrationPollParams {
  scode: string;
}

export type WeComRegistrationPollResult =
  | { status: "pending"; interval: number }
  | { status: "success"; botId: string; secret: string }
  | { status: "expired" | "error"; message?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown> | null | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function getWeComPlatCode(): number {
  switch (process.platform) {
    case "darwin":
      return 1;
    case "win32":
      return 2;
    case "linux":
      return 3;
    default:
      return 0;
  }
}

function unwrapData(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) {
    return {};
  }
  return isRecord(payload.data) ? payload.data : payload;
}

export function buildWeComRegistrationPageUrl(scode: string): string {
  return `${WECOM_QR_PAGE_URL}?source=${WECOM_QR_REQUEST_SOURCE}&scode=${encodeURIComponent(scode)}`;
}

export async function beginWeComRegistration(): Promise<WeComRegistrationBeginResult> {
  const url = `${WECOM_QR_GENERATE_URL}?source=${WECOM_QR_REQUEST_SOURCE}&plat=${getWeComPlatCode()}`;
  const response = await fetchBotProviderJson<unknown>(
    url,
    { method: "GET" },
    WECOM_QR_REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`WeCom registration generate failed: HTTP ${response.status}`);
  }
  const data = unwrapData(response.payload);
  const scode = readString(data, "scode");
  const authUrl = readString(data, "auth_url") || readString(data, "authUrl");
  if (!scode || !authUrl) {
    throw new Error("WeCom registration did not return a QR code.");
  }
  return {
    scode,
    authUrl,
    pageUrl: buildWeComRegistrationPageUrl(scode),
    interval: WECOM_QR_LOGIN_INTERVAL_SECONDS,
    expiresAt: Date.now() + WECOM_QR_LOGIN_EXPIRE_SECONDS * 1000,
  };
}

/**
 * 只把 success 当终态：扫码完成前服务端只回 init/pending，未知状态一律继续等待。
 */
export function readWeComRegistrationPollResult(payload: unknown): WeComRegistrationPollResult {
  const data = unwrapData(payload);
  const status = readString(data, "status").toLowerCase();
  if (status === "success") {
    const botInfo = isRecord(data.bot_info) ? data.bot_info : null;
    const botId = readString(botInfo, "botid") || readString(botInfo, "bot_id");
    const secret = readString(botInfo, "secret");
    if (!botId || !secret) {
      return { status: "error", message: "WeCom registration succeeded but returned no Bot ID." };
    }
    return { status: "success", botId, secret };
  }
  if (status === "expired" || status === "timeout") {
    return { status: "expired" };
  }
  if (status === "error" || status === "failed") {
    return {
      status: "error",
      message: readString(data, "errmsg") || "WeCom registration failed.",
    };
  }
  // init / pending / 其它未知状态都继续等待；扫码完成前服务端不会给出终态。
  return { status: "pending", interval: WECOM_QR_LOGIN_INTERVAL_SECONDS };
}

export async function pollWeComRegistration(
  params: WeComRegistrationPollParams,
): Promise<WeComRegistrationPollResult> {
  const url = `${WECOM_QR_QUERY_URL}?scode=${encodeURIComponent(params.scode)}`;
  let response;
  try {
    response = await fetchBotProviderJson<unknown>(
      url,
      { method: "GET" },
      WECOM_QR_REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      // 与微信扫码一致：等待扫码期间接口可能长时间不回，超时不等于失败，继续串行轮询。
      return { status: "pending", interval: WECOM_QR_LOGIN_INTERVAL_SECONDS };
    }
    throw error;
  }
  if (!response.ok) {
    return {
      status: "error",
      message: `WeCom registration query failed: HTTP ${response.status}`,
    };
  }
  return readWeComRegistrationPollResult(response.payload);
}
