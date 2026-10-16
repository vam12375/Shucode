import type {
  BotConfig,
  BotOutboundMessage,
  BotProvider,
  BotProviderCallbackResult,
  BotsConfigFile,
} from "@shucode/shared";
import type { ICredentialService } from "../credential/credential.js";
import { startWeComBotWebSocket, type WeComWebSocketClient } from "./providers/wecomProvider.js";
import {
  acquireWeComWebSocketLock,
  assertBotCallbackSucceeded,
  BOT_RUNTIME_LOCK_RETRY_MS,
  createBotConnectionFingerprint,
  createLatestRuntimeRefreshQueue,
  type BotRuntimeLogger,
  type BotRuntimeStatusSink,
  waitFor,
  waitForAbort,
} from "./channelRuntime.js";

interface WeComChannelRuntimeDeps {
  runBackgroundTasks?: boolean;
  credentialService: ICredentialService;
  logger: BotRuntimeLogger;
  statusSink: BotRuntimeStatusSink;
  ensureBotStorageMigrated(): Promise<void>;
  readConfig(): Promise<BotsConfigFile>;
  summarizeCallbackPayload(payload: unknown): string;
  processProviderCallback(
    provider: BotProvider,
    payload: unknown,
  ): Promise<BotProviderCallbackResult>;
}

export function createWeComChannelRuntime(deps: WeComChannelRuntimeDeps) {
  interface RuntimeEntry {
    controller: AbortController;
    fingerprint: string;
    done: Promise<void>;
  }

  const runtimes = new Map<string, RuntimeEntry>();
  const refreshQueue = createLatestRuntimeRefreshQueue();

  function isActiveWeComBot(bot: BotConfig): boolean {
    return (
      bot.provider === "wecom" &&
      bot.enabled &&
      Boolean(bot.credentialRef) &&
      Boolean(bot.wecomBotId)
    );
  }

  async function getConnectionFingerprint(bot: BotConfig): Promise<string> {
    const credential = bot.credentialRef
      ? await deps.credentialService.load(bot.credentialRef)
      : null;
    return createBotConnectionFingerprint([
      bot.provider,
      bot.wecomBotId ?? "",
      bot.credentialRef ?? "",
      credential ?? "",
    ]);
  }

  async function runBot(bot: BotConfig, signal: AbortSignal): Promise<void> {
    let client: WeComWebSocketClient | null = null;
    while (!signal.aborted) {
      let lock: Awaited<ReturnType<typeof acquireWeComWebSocketLock>>;
      try {
        lock = await acquireWeComWebSocketLock(bot);
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        // 锁目录异常不能中断重试循环，否则多窗口关闭会留下未处理 rejection。
        deps.logger.warn(
          undefined,
          `acquire WeCom WebSocket lock failed bot=${bot.id}: ${error instanceof Error ? `${error.message}${"code" in error && typeof error.code === "string" ? ` code=${error.code}` : ""}` : String(error)}`,
        );
        deps.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: "error",
          message: `WeCom WebSocket lock failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        await waitFor(5_000, signal);
        continue;
      }
      if (!lock) {
        deps.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: "idle",
          messageId: "bots.runtime.wecomWebSocketHandledElsewhere",
          message: "WeCom WebSocket is handled by another Shucode window.",
        });
        await waitFor(BOT_RUNTIME_LOCK_RETRY_MS, signal);
        continue;
      }
      let retryAfterError = false;
      try {
        deps.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: "connected",
          messageId: "bots.runtime.wecomWebSocketConnecting",
          message: "WeCom WebSocket is connecting.",
        });
        client = await startWeComBotWebSocket({
          bot,
          signal,
          onConnectionStateChange: (state) => {
            deps.statusSink.setRuntimeStatus({
              botId: bot.id,
              provider: bot.provider,
              status: "connected",
              message:
                state === "reconnecting"
                  ? "WeCom WebSocket is reconnecting."
                  : "WeCom WebSocket is running.",
              messageId:
                state === "reconnecting"
                  ? "bots.runtime.wecomWebSocketConnecting"
                  : "bots.runtime.wecomWebSocketRunning",
            });
          },
          deps: {
            loadCredential: (key) => deps.credentialService.load(key),
            logger: {
              debug: (message) => deps.logger.debug(undefined, message),
              info: (message) => deps.logger.info(undefined, message),
              warn: (message) => deps.logger.warn(undefined, message),
            },
          },
          onPayload: async (payload) => {
            if (signal.aborted) {
              return undefined;
            }
            deps.logger.debug(
              undefined,
              `wecom websocket payload bot=${bot.id} ${deps.summarizeCallbackPayload(payload)}`,
            );
            const callbackResult = await deps.processProviderCallback("wecom", payload);
            assertBotCallbackSucceeded("WeCom", callbackResult);
            return callbackResult.replies[0] as BotOutboundMessage | undefined;
          },
        });
        deps.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: "connected",
          // 运行状态会直接展示到 UI，补齐 messageId 让前端按当前语言渲染。
          message: "WeCom WebSocket is running.",
          messageId: "bots.runtime.wecomWebSocketRunning",
        });
        // 被其它端接管或重连耗尽都会结束 terminated，必须回到外层恢复循环。
        await Promise.race([waitForAbort(signal), client.terminated]);
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        deps.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: "error",
          message: `WeCom WebSocket failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        retryAfterError = true;
      } finally {
        if (client) {
          try {
            client.close();
          } catch (error) {
            deps.logger.debug(
              undefined,
              `close WeCom WebSocket failed bot=${bot.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          client = null;
        }
        await lock.release().catch((error: unknown) => {
          deps.logger.warn(
            undefined,
            `release WeCom WebSocket lock failed bot=${bot.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
      if (retryAfterError) {
        await waitFor(5_000, signal);
      }
    }
  }

  async function stopWebSocket(botId: string): Promise<void> {
    const runtime = runtimes.get(botId);
    runtime?.controller.abort();
    if (runtime) {
      await runtime.done;
      if (runtimes.get(botId) === runtime) {
        runtimes.delete(botId);
      }
    }
    const previous = deps.statusSink.getRuntimeStatus(botId);
    if (previous) {
      deps.statusSink.setRuntimeStatus({
        ...previous,
        status: "idle",
        messageId: "bots.runtime.wecomWebSocketStopped",
        message: "WeCom WebSocket is stopped.",
      });
    }
  }

  function startWebSocket(bot: BotConfig, fingerprint: string): void {
    if (runtimes.has(bot.id)) {
      return;
    }
    const controller = new AbortController();
    deps.statusSink.setRuntimeStatus({
      botId: bot.id,
      provider: bot.provider,
      status: "connected",
      messageId: "bots.runtime.wecomWebSocketStarting",
      message: "WeCom WebSocket is starting.",
    });
    const runtime: RuntimeEntry = {
      controller,
      fingerprint,
      done: Promise.resolve(),
    };
    runtime.done = runBot(bot, controller.signal).finally(() => {
      if (runtimes.get(bot.id) === runtime) {
        runtimes.delete(bot.id);
        const previous = deps.statusSink.getRuntimeStatus(bot.id);
        if (previous?.status === "connected") {
          deps.statusSink.setRuntimeStatus({
            botId: bot.id,
            provider: bot.provider,
            status: "idle",
            messageId: "bots.runtime.wecomWebSocketStopped",
            message: "WeCom WebSocket is stopped.",
          });
        }
      }
    });
    runtimes.set(bot.id, runtime);
  }

  async function reconcile(
    config: BotsConfigFile | undefined,
    isLatest: () => boolean,
  ): Promise<void> {
    await deps.ensureBotStorageMigrated();
    const currentConfig = config ?? (await deps.readConfig());
    if (!isLatest()) {
      return;
    }
    const activeWeComIds = new Set(
      currentConfig.bots.filter(isActiveWeComBot).map((bot) => bot.id),
    );
    for (const botId of runtimes.keys()) {
      if (!activeWeComIds.has(botId)) {
        await stopWebSocket(botId);
        if (!isLatest()) {
          return;
        }
      }
    }
    for (const bot of currentConfig.bots) {
      if (isActiveWeComBot(bot)) {
        const fingerprint = await getConnectionFingerprint(bot);
        if (!isLatest()) {
          return;
        }
        const runtime = runtimes.get(bot.id);
        if (runtime && runtime.fingerprint !== fingerprint) {
          // BotID 或凭据变化后旧连接仍持有旧配置，必须先完整停止再按新指纹重连。
          await stopWebSocket(bot.id);
          if (!isLatest()) {
            return;
          }
        }
        startWebSocket(bot, fingerprint);
      } else if (bot.provider === "wecom" && !bot.enabled) {
        deps.statusSink.setRuntimeStatus({
          botId: bot.id,
          provider: bot.provider,
          status: "disabled",
          messageId: "bots.runtime.botDisabled",
          message: "Bot is disabled.",
        });
      }
    }
  }

  function refresh(config?: BotsConfigFile): Promise<void> {
    return refreshQueue.enqueue((isLatest) => reconcile(config, isLatest));
  }

  function scheduleRefresh(config?: BotsConfigFile): void {
    if (deps.runBackgroundTasks === false) {
      // 远端 host 只暴露控制面服务；长连接必须留在本地桌面 Host，避免配置变更后重新抢跑。
      return;
    }
    void refresh(config).catch((error: unknown) => {
      deps.logger.warn(
        undefined,
        `refresh WeCom WebSocket failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async function dispose(): Promise<void> {
    refreshQueue.invalidate();
    const activeRuntimes = [...runtimes.values()];
    for (const runtime of activeRuntimes) {
      runtime.controller.abort();
    }
    // abort 只发出取消信号；销毁终态必须等连接关闭与跨进程锁释放完成。
    await Promise.allSettled(activeRuntimes.map((runtime) => runtime.done));
    for (const [botId, runtime] of runtimes) {
      if (activeRuntimes.includes(runtime)) {
        runtimes.delete(botId);
      }
    }
  }

  return {
    dispose,
    refresh,
    scheduleRefresh,
    stopWebSocket,
  };
}
