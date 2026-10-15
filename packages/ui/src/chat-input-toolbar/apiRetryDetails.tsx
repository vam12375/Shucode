import type { useShucodeIntl } from "@/i18n/IntlProvider.js";

type Intl = ReturnType<typeof useShucodeIntl>["intl"];

/**
 * CLI 投影层（product-projection-model-values.ts）归一后的 reasonCode 全集。
 * 映射文案在 i18n `chat.apiRetryReason.*`；未收录的 code 原样显示，不猜测。
 */
export const API_RETRY_REASON_MESSAGE_IDS: Readonly<Record<string, string>> = {
  "fault.provider.rateLimited": "chat.apiRetryReason.rateLimited",
  "fault.provider.serverError": "chat.apiRetryReason.serverError",
  "fault.provider.requestFailed": "chat.apiRetryReason.requestFailed",
  "fault.network.timeout": "chat.apiRetryReason.networkTimeout",
  "fault.network.unreachable": "chat.apiRetryReason.networkUnreachable",
  "fault.network.sseStalled": "chat.apiRetryReason.sseStalled",
  "fault.network.sseDisconnected": "chat.apiRetryReason.sseDisconnected",
};

/**
 * v4 路径的 error 字段承载归一 reasonCode（toRetryStatus），旧 desktop 路径承载
 * 真实错误文本：已知 code 映射可读文案，未知文本原样作为原因显示。
 */
export function resolveApiRetryReasonText(
  codeOrError: string | null | undefined,
  intl: Intl,
): string | null {
  const text = codeOrError?.trim();
  if (!text) return null;
  const messageId = API_RETRY_REASON_MESSAGE_IDS[text];
  return messageId ? intl.formatMessage({ id: messageId }) : text;
}

/** 原因行的原始形态（如可读文案不同）单独展示，便于用户反馈时给出准确 code。 */
export function resolveApiRetryRawErrorText(
  codeOrError: string | null | undefined,
  reasonText: string | null,
): string | null {
  const text = codeOrError?.trim();
  if (!text || text === reasonText) return null;
  return text;
}

/** 运行时只推送下次重试的绝对时刻快照；渲染固定时间不倒数，避免视觉倒计时卡住的错觉。 */
export function formatNextRetryTime(
  nextRetryAt: number | null | undefined,
  locale: string,
): string | null {
  if (!nextRetryAt || !Number.isFinite(nextRetryAt) || nextRetryAt <= 0) return null;
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(nextRetryAt);
}

export function ApiRetryDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}
