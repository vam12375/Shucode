/* eslint-disable max-lines -- 企业微信智能机器人长连接、帧解析与回复协议集中维护；拆散会割裂帧语义与回复上下文。 */
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { BaseMessage, EventMessage, WSClient, WsFrame } from "@wecom/aibot-node-sdk";
import type {
  BotConfig,
  BotInboundAttachment,
  BotInboundMessage,
  BotOutboundMessage,
} from "@shucode/shared";
import type { BotProviderAdapter, BotProviderDownloadedAttachment } from "./types.js";

type WeComSdk = typeof import("@wecom/aibot-node-sdk");
type WeComFrame = WsFrame<BaseMessage>;
type WeComEventFrame = WsFrame<EventMessage>;

const WECOM_REPLY_CONTEXT_LIMIT = 200;
const WECOM_MARKDOWN_MAX_BYTES = 20_480;
const WECOM_STREAM_ID_PREFIX = "shucode-wecom";
// 群聊里机器人必须被 @ 才收到消息，正文带前缀会破坏 /status 这类命令解析。
const WECOM_MENTION_PREFIX_PATTERN = /^@[^\s@]+[\s\u3000]+/u;

export interface WeComProviderDeps {
  loadCredential(key: string): Promise<string | null>;
  onDeliveryResult?(bot: BotConfig, error: string | undefined): void;
  logger?: WeComProviderLogger;
}

export interface WeComProviderLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
}

/** 一条入站消息的回复上下文：被动回复必须回填它的 req_id。 */
interface WeComReplyContext {
  reqId: string;
  chatId?: string;
  chatType: "single" | "group";
}

interface WeComActiveConnection {
  client: WSClient;
  contexts: Map<string, WeComReplyContext>;
}

/** 长连接的活跃注册表：回复与附件下载都依赖它拿到当前连接。 */
const activeConnections = new Map<string, WeComActiveConnection>();

export interface WeComWebSocketClient {
  terminated: Promise<void>;
  close(): void;
}

export interface WeComWebSocketParams {
  bot: BotConfig;
  deps: WeComProviderDeps;
  onPayload: (payload: unknown) => Promise<BotOutboundMessage | undefined>;
  onConnectionStateChange?: (state: "reconnecting" | "connected") => void;
  signal?: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown> | null | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}

async function loadWeComSdk(): Promise<WeComSdk> {
  const sdk = await import("@wecom/aibot-node-sdk");
  if (typeof sdk.WSClient !== "function") {
    throw new Error("WeCom SDK did not expose WSClient.");
  }
  return sdk;
}

async function readWeComBotSecret(bot: BotConfig, deps: WeComProviderDeps): Promise<string | null> {
  if (!bot.wecomBotId || !bot.credentialRef) {
    return null;
  }
  return deps.loadCredential(bot.credentialRef);
}

function createSdkLogger(deps: WeComProviderDeps) {
  return {
    debug: (message: string, ...args: unknown[]) =>
      deps.logger?.debug(`${message} ${args.join(" ")}`),
    info: (message: string, ...args: unknown[]) =>
      deps.logger?.info(`${message} ${args.join(" ")}`),
    warn: (message: string, ...args: unknown[]) =>
      deps.logger?.warn(`${message} ${args.join(" ")}`),
    error: (message: string, ...args: unknown[]) =>
      deps.logger?.warn(`${message} ${args.join(" ")}`),
  };
}

function trackReplyContext(connection: WeComActiveConnection, context: WeComReplyContext): void {
  connection.contexts.set(context.reqId, context);
  while (connection.contexts.size > WECOM_REPLY_CONTEXT_LIMIT) {
    const oldest = connection.contexts.keys().next().value;
    if (oldest === undefined || oldest === context.reqId) {
      break;
    }
    connection.contexts.delete(oldest);
  }
}

function buildWeComStreamId(): string {
  return `${WECOM_STREAM_ID_PREFIX}-${randomUUID()}`;
}

function clampWeComMarkdown(text: string): string {
  if (Buffer.byteLength(text, "utf8") <= WECOM_MARKDOWN_MAX_BYTES) {
    return text;
  }
  // 企微 stream.content 上限 20480 字节，超长原文直接发送会被服务端拒绝。
  const marker = "\n\n…（内容过长已截断）";
  const budget = WECOM_MARKDOWN_MAX_BYTES - Buffer.byteLength(marker, "utf8");
  return `${Buffer.from(text, "utf8").subarray(0, budget).toString("utf8")}${marker}`;
}

function stripWeComMentionPrefix(text: string): string {
  let current = text.trim();
  while (WECOM_MENTION_PREFIX_PATTERN.test(current)) {
    current = current.replace(WECOM_MENTION_PREFIX_PATTERN, "").trim();
  }
  return current;
}

function buildWeComAttachment(params: {
  kind: BotInboundAttachment["kind"];
  index: number;
  url: string;
  aesKey: string;
  filename: string;
  mimeType: string;
}): BotInboundAttachment {
  return {
    id: params.url || `wecom-${params.kind}-${params.index + 1}`,
    kind: params.kind,
    filename: params.filename,
    mimeType: params.mimeType,
    downloadUrl: params.url,
    ...(params.aesKey ? { providerMetadata: { wecomAesKey: params.aesKey } } : {}),
  };
}

function readWeComMediaSource(
  body: Record<string, unknown>,
  key: string,
): { url: string; aesKey: string } | null {
  const source = isRecord(body[key]) ? body[key] : null;
  const url = readString(source, "url");
  if (!url) {
    return null;
  }
  return { url, aesKey: readString(source, "aeskey") || readString(source, "aes_key") };
}

function readWeComTextPart(body: Record<string, unknown>): string {
  const text = isRecord(body.text) ? readString(body.text, "content") : "";
  if (text) {
    return text;
  }
  // 语音消息只回传转写文本，没有媒体文件，直接当文本处理。
  const voice = isRecord(body.voice) ? readString(body.voice, "content") : "";
  if (voice) {
    return voice;
  }
  if (isRecord(body.mixed)) {
    const items = Array.isArray(body.mixed.msg_item) ? body.mixed.msg_item : [];
    return items
      .filter(isRecord)
      .filter((item) => readString(item, "msgtype") === "text")
      .map((item) => (isRecord(item.text) ? readString(item.text, "content") : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function readWeComAttachments(body: Record<string, unknown>): BotInboundAttachment[] {
  const attachments: BotInboundAttachment[] = [];
  const image = readWeComMediaSource(body, "image");
  if (image) {
    attachments.push(
      buildWeComAttachment({
        kind: "image",
        index: 0,
        url: image.url,
        aesKey: image.aesKey,
        filename: "wecom-image-1.jpg",
        mimeType: "image/jpeg",
      }),
    );
  }
  const file = readWeComMediaSource(body, "file");
  if (file) {
    attachments.push(
      buildWeComAttachment({
        kind: "file",
        index: 0,
        url: file.url,
        aesKey: file.aesKey,
        // 企微文件消息只给下载地址，不给文件名；保留通用名由上层按需重命名。
        filename: "wecom-file-1",
        mimeType: "application/octet-stream",
      }),
    );
  }
  const video = readWeComMediaSource(body, "video");
  if (video) {
    attachments.push(
      buildWeComAttachment({
        kind: "video",
        index: 0,
        url: video.url,
        aesKey: video.aesKey,
        filename: "wecom-video-1.mp4",
        mimeType: "video/mp4",
      }),
    );
  }
  if (isRecord(body.mixed)) {
    const items = Array.isArray(body.mixed.msg_item) ? body.mixed.msg_item : [];
    items.filter(isRecord).forEach((item, index) => {
      if (readString(item, "msgtype") !== "image") {
        return;
      }
      const mixedImage = isRecord(item.image) ? item.image : null;
      const url = readString(mixedImage, "url");
      if (!url) {
        return;
      }
      attachments.push(
        buildWeComAttachment({
          kind: "image",
          index,
          url,
          aesKey: readString(mixedImage, "aeskey"),
          filename: `wecom-image-${index + 1}.jpg`,
          mimeType: "image/jpeg",
        }),
      );
    });
  }
  return attachments;
}

function buildWeComInboundMessage(botId: string, frame: WeComFrame): BotInboundMessage | null {
  const body = isRecord(frame.body) ? frame.body : null;
  if (!body) {
    return null;
  }
  const msgId = readString(body, "msgid");
  const from = isRecord(body.from) ? body.from : null;
  const userId = readString(from, "userid");
  if (!msgId || !userId) {
    // msgid 是企微的排重键；缺失时无法保证幂等，宁可丢弃也不能产生重复任务。
    return null;
  }
  const chatType = readString(body, "chattype") === "group" ? "group" : "private";
  const rawText = readWeComTextPart(body);
  const text = chatType === "group" ? stripWeComMentionPrefix(rawText) : rawText.trim();
  const attachments = readWeComAttachments(body);
  if (!text && attachments.length === 0) {
    return null;
  }
  return {
    botId,
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
    actor: {
      provider: "wecom",
      botId,
      providerUserId: userId,
      chatType,
      chatId: readString(body, "chatid") || undefined,
      providerMessageId: msgId,
      providerContextToken: readString(frame.headers, "req_id") || undefined,
    },
  };
}

function parseWeComFramePayload(payload: unknown): WeComFrame | null {
  if (!isRecord(payload)) {
    return null;
  }
  const frame = isRecord(payload.frame) ? payload.frame : null;
  if (!frame || !isRecord(frame.headers)) {
    return null;
  }
  const cmd = readString(frame, "cmd");
  if (cmd && cmd !== "aibot_msg_callback") {
    return null;
  }
  return frame as unknown as WeComFrame;
}

function buildWeComPayloadForFrame(bot: BotConfig, frame: WeComFrame): unknown {
  return { botId: bot.id, shucodeProvider: bot.provider, frame };
}

interface WeComReplyRequest {
  frame: { headers: { req_id: string } };
  streamId: string;
  content: string;
  finish: boolean;
}

/**
 * 被动回复必须回填入站回调的 req_id，否则消息会落到错误会话；
 * 每条回复使用独立 stream id，以一次性 finish 结束。
 */
function buildWeComReplyRequest(
  message: Pick<BotOutboundMessage, "text">,
  context: Pick<WeComReplyContext, "reqId">,
): WeComReplyRequest {
  return {
    frame: { headers: { req_id: context.reqId } },
    streamId: buildWeComStreamId(),
    content: clampWeComMarkdown(message.text),
    finish: true,
  };
}

export type WeComOutboundPlan =
  | { kind: "reply"; request: WeComReplyRequest }
  | { kind: "send"; chatId: string; content: string };

/**
 * 出站路由：拿得到入站 req_id 就用被动回复，否则退回主动推送。
 * 主动推送的 chatid 在单聊里就是 userid；群聊缺会话地址时只能按单聊路由。
 */
export function planWeComOutbound(
  message: Pick<BotOutboundMessage, "text" | "providerUserId">,
  context: WeComReplyContext | undefined,
): WeComOutboundPlan {
  if (context) {
    return { kind: "reply", request: buildWeComReplyRequest(message, context) };
  }
  return {
    kind: "send",
    chatId: message.providerUserId,
    content: clampWeComMarkdown(message.text),
  };
}

export async function startWeComBotWebSocket(
  params: WeComWebSocketParams,
): Promise<WeComWebSocketClient> {
  const { bot, deps, onPayload, onConnectionStateChange, signal } = params;
  if (!bot.wecomBotId) {
    throw new Error("WeCom Bot ID is required.");
  }
  const secret = await readWeComBotSecret(bot, deps);
  if (!secret) {
    throw new Error("WeCom Bot ID and Secret are required.");
  }
  if (signal?.aborted) {
    throw new Error("WeCom WebSocket startup aborted.");
  }
  // SDK 全量源码只在真正建立长连接时加载；扫码与配置路径不承担这份开销。
  const sdk = await loadWeComSdk();
  if (signal?.aborted) {
    throw new Error("WeCom WebSocket startup aborted.");
  }
  const client = new sdk.WSClient({
    botId: bot.wecomBotId,
    secret,
    logger: createSdkLogger(deps),
  });
  const connection: WeComActiveConnection = { client, contexts: new Map() };
  activeConnections.set(bot.id, connection);

  let settleTerminated: () => void = () => undefined;
  const terminated = new Promise<void>((resolve) => {
    settleTerminated = resolve;
  });
  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    if (activeConnections.get(bot.id) === connection) {
      activeConnections.delete(bot.id);
    }
    try {
      client.disconnect();
    } catch (error) {
      deps.logger?.debug(
        `close WeCom WebSocket failed bot=${bot.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const terminate = (): void => {
    settleTerminated();
  };

  client.on("authenticated", () => {
    onConnectionStateChange?.("connected");
  });
  client.on("reconnecting", () => {
    onConnectionStateChange?.("reconnecting");
  });
  client.on("message", (frame: WeComFrame) => {
    const body = isRecord(frame.body) ? frame.body : null;
    const reqId = readString(frame.headers, "req_id");
    if (reqId && body) {
      trackReplyContext(connection, {
        reqId,
        chatId: readString(body, "chatid") || undefined,
        chatType: readString(body, "chattype") === "group" ? "group" : "single",
      });
    }
    void onPayload(buildWeComPayloadForFrame(bot, frame)).catch((error: unknown) => {
      deps.logger?.warn(
        `WeCom message handling failed bot=${bot.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  });
  client.on("event.disconnected_event", (frame: WeComEventFrame) => {
    // 同一机器人只允许一条长连接；新连接订阅后旧连接会被服务端断开，不能立刻抢回。
    deps.logger?.warn(
      `WeCom long connection was taken over bot=${bot.id} req=${readString(frame.headers, "req_id")}`,
    );
    terminate();
  });
  client.on("disconnected", (reason: string) => {
    deps.logger?.debug(`WeCom WebSocket disconnected bot=${bot.id} reason=${reason}`);
  });
  client.on("error", (error: Error) => {
    // 认证失败与重连耗尽后 SDK 不再自愈，必须交给 channel runtime 决策重启。
    const code = (error as Error & { code?: string }).code ?? "";
    if (code === "WS_AUTH_FAILURE_EXHAUSTED" || code === "WS_RECONNECT_EXHAUSTED") {
      deps.logger?.warn(`WeCom WebSocket gave up bot=${bot.id}: ${error.message}`);
      terminate();
    }
  });

  const onAbort = (): void => {
    close();
  };
  if (signal?.aborted) {
    close();
    throw new Error("WeCom WebSocket startup aborted.");
  }
  signal?.addEventListener("abort", onAbort, { once: true });

  client.connect();
  return {
    terminated,
    close(): void {
      signal?.removeEventListener("abort", onAbort);
      close();
    },
  };
}

export function createWeComBotProvider(deps: WeComProviderDeps): BotProviderAdapter {
  async function trackDelivery<T>(bot: BotConfig, write: () => Promise<T>): Promise<T> {
    try {
      const result = await write();
      deps.onDeliveryResult?.(bot, undefined);
      return result;
    } catch (error) {
      deps.onDeliveryResult?.(bot, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  return {
    async test(bot) {
      if (!bot.enabled) {
        return { ok: false, message: "WeCom bot is disabled." };
      }
      if (!bot.wecomBotId || !bot.credentialRef) {
        return { ok: false, message: "WeCom Bot ID and Secret are required." };
      }
      const running = activeConnections.get(bot.id);
      if (running?.client.isConnected) {
        // 已有一条活跃长连接时再订阅会把它踢下线，这里直接复用运行中的连接结论。
        return { ok: true, message: "WeCom long connection is running." };
      }
      const secret = await readWeComBotSecret(bot, deps);
      if (!secret) {
        return { ok: false, message: "WeCom bot secret is missing." };
      }
      const sdk = await loadWeComSdk();
      const client = new sdk.WSClient({
        botId: bot.wecomBotId,
        secret,
        logger: createSdkLogger(deps),
        // 试连只需要一次判定：限制重试次数，让认证失败尽快以错误返回。
        maxAuthFailureAttempts: 1,
        maxReconnectAttempts: 0,
        reconnectInterval: 500,
      });
      return await new Promise<{ ok: boolean; message: string }>((resolve) => {
        let settled = false;
        const finish = (result: { ok: boolean; message: string }): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          try {
            client.disconnect();
          } catch {
            // 试连清理失败不影响结论。
          }
          resolve(result);
        };
        const timer = setTimeout(() => {
          finish({ ok: false, message: "WeCom long connection timed out." });
        }, 15_000);
        client.on("authenticated", () => {
          finish({ ok: true, message: "WeCom long connection is reachable." });
        });
        client.on("error", (error: Error) => {
          finish({ ok: false, message: error.message });
        });
        client.connect();
      });
    },

    async send(bot, message) {
      const connection = activeConnections.get(bot.id);
      if (!connection) {
        throw new Error("WeCom long connection is not running.");
      }
      const context = message.providerContextToken
        ? connection.contexts.get(message.providerContextToken)
        : undefined;
      const plan = planWeComOutbound(message, context);
      if (plan.kind === "reply") {
        await trackDelivery(bot, () =>
          connection.client.replyStream(
            plan.request.frame,
            plan.request.streamId,
            plan.request.content,
            plan.request.finish,
          ),
        );
        return;
      }
      await trackDelivery(bot, () =>
        connection.client.sendMessage(plan.chatId, {
          msgtype: "markdown",
          markdown: { content: plan.content },
        }),
      );
    },

    async downloadAttachment(bot, attachment): Promise<BotProviderDownloadedAttachment | null> {
      const connection = activeConnections.get(bot.id);
      if (!connection || !attachment.downloadUrl) {
        return null;
      }
      const aesKey = attachment.providerMetadata?.wecomAesKey;
      const downloaded = await connection.client.downloadFile(attachment.downloadUrl, aesKey);
      return { attachment, data: new Uint8Array(downloaded.buffer) };
    },

    parseCallback(payload: unknown): BotInboundMessage[] {
      if (!isRecord(payload)) {
        return [];
      }
      const botId = readString(payload, "botId");
      if (!botId) {
        return [];
      }
      const frame = parseWeComFramePayload(payload);
      if (!frame) {
        return [];
      }
      const message = buildWeComInboundMessage(botId, frame);
      return message ? [message] : [];
    },
  };
}
