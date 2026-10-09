import type { ShucodeMessageWithParts } from "./shucode-protocol-legacy-types.js";
import { textFromShucodeMessageParts } from "./shucode-protocol-legacy-types.js";
import type { ShucodeStreamEvent } from "./shucode-task-types-core.js";

export interface ShucodeBackgroundTaskNotificationInfo {
  error?: string;
  outputFile?: string;
  result?: string;
  status?: string;
  summary?: string;
  taskId?: string;
}

export function parseShucodeBackgroundTaskNotificationText(
  text: string | undefined,
): { notification: ShucodeBackgroundTaskNotificationInfo; toolUseId: string } | null {
  const trimmed = text?.trim();
  if (!trimmed?.startsWith("<task-notification>")) {
    return null;
  }
  const toolUseId = readTaskNotificationTag(trimmed, "tool-use-id");
  if (!toolUseId) {
    return null;
  }
  return {
    toolUseId,
    notification: {
      error: readTaskNotificationTag(trimmed, "error"),
      outputFile: readTaskNotificationTag(trimmed, "output-file"),
      result: readTaskNotificationTag(trimmed, "result"),
      status: readTaskNotificationTag(trimmed, "status"),
      summary: readTaskNotificationTag(trimmed, "summary"),
      taskId: readTaskNotificationTag(trimmed, "task-id"),
    },
  };
}

export function collectShucodeBackgroundTaskNotificationsByToolUseId(
  messages: readonly ShucodeMessageWithParts[],
): Map<string, ShucodeBackgroundTaskNotificationInfo> {
  const notifications = new Map<string, ShucodeBackgroundTaskNotificationInfo>();
  for (const message of messages) {
    if (message.info.role !== "user") {
      continue;
    }
    const parsed = parseShucodeBackgroundTaskNotificationText(
      textFromShucodeMessageParts(message.parts),
    );
    if (!parsed) {
      continue;
    }
    notifications.set(parsed.toolUseId, parsed.notification);
  }
  return notifications;
}

export function shucodeBackgroundTaskNotificationToolUpdateStatus(
  status: string | undefined,
): Extract<
  Extract<ShucodeStreamEvent, { type: "tool_call_update" }>["status"],
  "completed" | "failed" | "stopped"
> {
  if (status === "failed" || status === "lost") {
    return "failed";
  }
  // task-notification 的 killed/stopped 都表示被停止，不能折成 completed。
  if (status === "stopped" || status === "killed") {
    return "stopped";
  }
  return "completed";
}

export function attachShucodeBackgroundTaskNotificationToRaw(
  raw: unknown,
  notification: ShucodeBackgroundTaskNotificationInfo | undefined,
): unknown {
  if (!notification) {
    return raw;
  }
  const record = asPlainRecord(raw);
  const meta = asPlainRecord(record._meta);
  const shucode = asPlainRecord(meta.shucode);
  return {
    ...record,
    _meta: {
      ...meta,
      shucode: {
        ...shucode,
        taskNotification: notification,
      },
    },
  };
}

function readTaskNotificationTag(text: string, tag: string): string | undefined {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "u"));
  const value = match?.[1]?.trim();
  return value ? decodeTaskNotificationXmlText(value) : undefined;
}

function decodeTaskNotificationXmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
