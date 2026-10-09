import type { Event, IDisposable } from "@shucode/rpc";
import type { ShucodeProtocolMessage } from "@shucode/shared";

export type ShucodeProtocolTransportKind = "stdio" | "websocket" | "memory";

export interface ShucodeProtocolTransportClosedEvent {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  reason?: string;
}

export interface ShucodeProtocolTransport extends IDisposable {
  readonly kind: ShucodeProtocolTransportKind;
  readonly onMessage: Event<ShucodeProtocolMessage>;
  readonly onClose: Event<ShucodeProtocolTransportClosedEvent>;
  send(message: ShucodeProtocolMessage): Promise<void>;
  disposeAndWait?(): Promise<void>;
}
