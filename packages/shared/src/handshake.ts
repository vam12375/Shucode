export interface HelloMessage {
  type: "shucode-hello";
  version: string;
  platform: string;
  arch: string;
  pid: number;
}

export interface HelloAckMessage {
  type: "shucode-hello-ack";
  version: string;
  clientId: string;
}
