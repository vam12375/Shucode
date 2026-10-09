import {
  ChannelClient,
  MessagePortProtocol,
  ProxyChannel,
  type MessagePortLike,
  type MessagePortPayload,
} from "@shucode/rpc";
import {
  IShucodeTaskService,
  type IShucodeTaskService as IShucodeTaskServiceShape,
} from "#src/session/shucodeTaskService.js";
import {
  IShucodeAgentService,
  type IShucodeAgentService as IShucodeAgentServiceShape,
} from "#src/shucode-agent/shucodeAgent.js";
import {
  IShucodeSessionService,
  type IShucodeSessionService as IShucodeSessionServiceShape,
} from "#src/shucode-session/shucodeSession.js";
import {
  IModelSelectionService,
  type IModelSelectionService as IModelSelectionServiceShape,
} from "#src/model-provider/providerFacadeServices.js";

interface PortLike {
  on?(event: "message", listener: (event: { data: MessagePortPayload }) => void): void;
  off?(event: "message", listener: (event: { data: MessagePortPayload }) => void): void;
  addEventListener?(
    event: "message",
    listener: (event: { data: MessagePortPayload }) => void,
  ): void;
  removeEventListener?(
    event: "message",
    listener: (event: { data: MessagePortPayload }) => void,
  ): void;
  postMessage(message: MessagePortPayload): void;
  start?(): void;
  close?(): void;
}

function toMessagePortLike(port: PortLike): MessagePortLike {
  return {
    addEventListener(type, listener) {
      if (port.addEventListener) {
        port.addEventListener(type, listener);
        return;
      }
      port.on?.(type, listener);
    },
    removeEventListener(type, listener) {
      if (port.removeEventListener) {
        port.removeEventListener(type, listener);
        return;
      }
      port.off?.(type, listener);
    },
    postMessage(data) {
      port.postMessage(data);
    },
    start() {
      port.start?.();
    },
    close() {
      port.close?.();
    },
  };
}

export interface RemoteBotWorkspaceRuntimeServices {
  shucodeAgentService: IShucodeAgentServiceShape;
  shucodeTaskService: IShucodeTaskServiceShape;
  shucodeSessionService: IShucodeSessionServiceShape;
  modelSelectionService: IModelSelectionServiceShape;
}

export function createRemoteRuntimeServicesFromPort(
  port: unknown,
): RemoteBotWorkspaceRuntimeServices {
  const protocol = new MessagePortProtocol(toMessagePortLike(port as PortLike));
  const client = new ChannelClient(protocol);
  return {
    shucodeAgentService: ProxyChannel.toService<IShucodeAgentServiceShape>(
      client.getChannel(IShucodeAgentService.channelName),
    ),
    shucodeTaskService: ProxyChannel.toService<IShucodeTaskServiceShape>(
      client.getChannel(IShucodeTaskService.channelName),
    ),
    shucodeSessionService: ProxyChannel.toService<IShucodeSessionServiceShape>(
      client.getChannel(IShucodeSessionService.channelName),
    ),
    modelSelectionService: ProxyChannel.toService<IModelSelectionServiceShape>(
      client.getChannel(IModelSelectionService.channelName),
    ),
  };
}
