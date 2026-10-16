import assert from "node:assert/strict";
import test from "node:test";
import { createWeComBotProvider, planWeComOutbound } from "../src/bots/providers/wecomProvider.js";
import {
  buildWeComRegistrationPageUrl,
  readWeComRegistrationPollResult,
} from "../src/bots/providers/wecomRegistration.js";

function createFrame(params: {
  body: Record<string, unknown>;
  reqId?: string;
  cmd?: string;
}): Record<string, unknown> {
  return {
    cmd: params.cmd ?? "aibot_msg_callback",
    headers: { req_id: params.reqId ?? "REQ-1" },
    body: params.body,
  };
}

function parseSingleMessage(frame: Record<string, unknown>, botId = "bot-wecom") {
  const adapter = createWeComBotProvider({ loadCredential: async () => "secret" });
  const payload = { botId, shucodeProvider: "wecom", frame };
  return adapter.parseCallback(payload);
}

test("wecom parseCallback: 单聊文本映射为入站消息并携带 req_id 上下文", () => {
  const messages = parseSingleMessage(
    createFrame({
      reqId: "REQ-TEXT",
      body: {
        msgid: "MSG-1",
        aibotid: "AIBOT",
        chattype: "single",
        from: { userid: "user-1" },
        msgtype: "text",
        text: { content: "/status" },
      },
    }),
  );
  assert.equal(messages.length, 1);
  const message = messages[0]!;
  assert.equal(message.botId, "bot-wecom");
  assert.equal(message.text, "/status");
  assert.equal(message.actor.provider, "wecom");
  assert.equal(message.actor.providerUserId, "user-1");
  assert.equal(message.actor.chatType, "private");
  assert.equal(message.actor.providerMessageId, "MSG-1");
  assert.equal(message.actor.providerContextToken, "REQ-TEXT");
  assert.equal(message.actor.chatId, undefined);
});

test("wecom parseCallback: 群聊剥掉 @ 前缀并保留 chatid", () => {
  const messages = parseSingleMessage(
    createFrame({
      body: {
        msgid: "MSG-2",
        chatid: "CHAT-9",
        chattype: "group",
        from: { userid: "user-2" },
        msgtype: "text",
        text: { content: "@Shucode机器人 /new" },
      },
    }),
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.text, "/new");
  assert.equal(messages[0]!.actor.chatType, "group");
  assert.equal(messages[0]!.actor.chatId, "CHAT-9");
});

test("wecom parseCallback: 单聊正文保留原始内容，不做 @ 剥离", () => {
  const messages = parseSingleMessage(
    createFrame({
      body: {
        msgid: "MSG-3",
        chattype: "single",
        from: { userid: "user-3" },
        msgtype: "text",
        text: { content: "@someone 帮我看下" },
      },
    }),
  );
  assert.equal(messages[0]!.text, "@someone 帮我看下");
});

test("wecom parseCallback: 缺 msgid 的消息被丢弃，避免丢失幂等键", () => {
  const messages = parseSingleMessage(
    createFrame({
      body: {
        chattype: "single",
        from: { userid: "user-4" },
        msgtype: "text",
        text: { content: "hello" },
      },
    }),
  );
  assert.deepEqual(messages, []);
});

test("wecom parseCallback: 图文混排合并文本并带出图片附件与解密密钥", () => {
  const messages = parseSingleMessage(
    createFrame({
      body: {
        msgid: "MSG-4",
        chattype: "single",
        from: { userid: "user-5" },
        msgtype: "mixed",
        mixed: {
          msg_item: [
            { msgtype: "text", text: { content: "看看这个" } },
            {
              msgtype: "image",
              image: { url: "https://cdn.example/a.jpg", aeskey: "aes-key-1" },
            },
          ],
        },
      },
    }),
  );
  assert.equal(messages.length, 1);
  const message = messages[0]!;
  assert.equal(message.text, "看看这个");
  assert.equal(message.attachments?.length, 1);
  const attachment = message.attachments![0]!;
  assert.equal(attachment.kind, "image");
  assert.equal(attachment.downloadUrl, "https://cdn.example/a.jpg");
  assert.equal(attachment.providerMetadata?.wecomAesKey, "aes-key-1");
});

test("wecom parseCallback: 语音消息按转写文本处理", () => {
  const messages = parseSingleMessage(
    createFrame({
      body: {
        msgid: "MSG-5",
        chattype: "single",
        from: { userid: "user-6" },
        msgtype: "voice",
        voice: { content: "帮我建一个任务" },
      },
    }),
  );
  assert.equal(messages[0]!.text, "帮我建一个任务");
});

test("wecom parseCallback: 只有附件没有文本时也进入消息链路", () => {
  const messages = parseSingleMessage(
    createFrame({
      body: {
        msgid: "MSG-6",
        chattype: "single",
        from: { userid: "user-7" },
        msgtype: "file",
        file: { url: "https://cdn.example/doc.pdf", aeskey: "aes-key-2" },
      },
    }),
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.text, "");
  assert.equal(messages[0]!.attachments?.[0]?.kind, "file");
});

test("wecom parseCallback: 事件帧不会进入消息链路", () => {
  const messages = parseSingleMessage(
    createFrame({
      cmd: "aibot_event_callback",
      body: {
        msgid: "EVENT-1",
        msgtype: "event",
        from: { userid: "user-8" },
        event: { eventtype: "enter_chat" },
      },
    }),
  );
  assert.deepEqual(messages, []);
});

test("wecom outbound: 有回调上下文时走被动回复并回填 req_id", () => {
  const plan = planWeComOutbound(
    { text: "收到", providerUserId: "user-1" },
    { reqId: "REQ-CTX", chatType: "single" },
  );
  assert.equal(plan.kind, "reply");
  if (plan.kind !== "reply") return;
  assert.equal(plan.request.frame.headers.req_id, "REQ-CTX");
  assert.equal(plan.request.finish, true);
  assert.equal(plan.request.content, "收到");
  assert.match(plan.request.streamId, /^shucode-wecom-/u);
});

test("wecom outbound: 超过 20480 字节的回复被截断而不是被服务端拒绝", () => {
  const plan = planWeComOutbound(
    { text: "a".repeat(30_000), providerUserId: "user-1" },
    { reqId: "REQ-LONG", chatType: "single" },
  );
  assert.equal(plan.kind, "reply");
  if (plan.kind !== "reply") return;
  assert.ok(Buffer.byteLength(plan.request.content, "utf8") <= 20_480);
  assert.ok(plan.request.content.endsWith("…（内容过长已截断）"));
});

test("wecom outbound: 同一会话的多次回复使用独立 stream id", () => {
  const context = { reqId: "REQ-SAME", chatType: "single" as const };
  const first = planWeComOutbound({ text: "第一条", providerUserId: "u" }, context);
  const second = planWeComOutbound({ text: "第二条", providerUserId: "u" }, context);
  const firstStream = first.kind === "reply" ? first.request.streamId : "";
  const secondStream = second.kind === "reply" ? second.request.streamId : "";
  assert.notEqual(firstStream, secondStream);
});

test("wecom outbound: 无回调上下文时按 userid 主动推送", () => {
  const plan = planWeComOutbound({ text: "定时任务已完成", providerUserId: "user-9" }, undefined);
  assert.deepEqual(plan, { kind: "send", chatId: "user-9", content: "定时任务已完成" });
});

test("wecom registration: 只把 success 当终态，其余状态继续轮询", () => {
  assert.deepEqual(readWeComRegistrationPollResult({ data: { status: "init" } }), {
    status: "pending",
    interval: 3,
  });
  assert.equal(
    readWeComRegistrationPollResult({ data: { status: "anything-unknown" } }).status,
    "pending",
  );
  assert.deepEqual(
    readWeComRegistrationPollResult({
      data: { status: "success", bot_info: { botid: "BOT-1", secret: "SEC-1" } },
    }),
    { status: "success", botId: "BOT-1", secret: "SEC-1" },
  );
  assert.equal(
    readWeComRegistrationPollResult({ data: { status: "success", bot_info: { botid: "BOT-1" } } })
      .status,
    "error",
  );
  assert.equal(readWeComRegistrationPollResult({ data: { status: "expired" } }).status, "expired");
  assert.equal(readWeComRegistrationPollResult({}).status, "pending");
});

test("wecom registration: 兜底二维码页面链接携带 scode", () => {
  const url = buildWeComRegistrationPageUrl("SCODE-1");
  assert.ok(url.startsWith("https://work.weixin.qq.com/ai/qc/gen?source=shucode&scode="));
  assert.ok(url.endsWith("SCODE-1"));
});
