import { z } from "zod";
import { nonEmptyStringSchema } from "./validation.js";
import { hostIncomingMessageSchema, hostResponseMessageSchema } from "./validation.js";
import { taskRealtimeHostDeliveryKindSchema } from "./task-realtime-core.js";

/**
 * Main ↔ TaskRealtime 协调器进程的帧协议。
 *
 * 协调器承载跨窗口 Host 的租约仲裁、流攒批/回放缓冲与会话消息路由（原 main 内
 * TaskRealtimeBus 状态的下沉，见 specs/desktop/main-process-state-ownership.md）。
 * Main 只按 hostId 转发帧，不解析业务负载：
 * - Main→协调器：Host 上行帧（hostResponseMessageSchema 原样封装）与生命周期控制；
 * - 协调器→Main：已仲裁的 Host 下行帧（hostIncomingMessageSchema）与诊断/日志。
 */

// ── Main → Coordinator ────────────────────────────────────────────

export const coordinatorHostUpMessageSchema = z
  .object({
    type: z.literal("coordinator/hostUp"),
    hostId: nonEmptyStringSchema,
    workspaceKeys: z.array(nonEmptyStringSchema),
    deliveryKind: taskRealtimeHostDeliveryKindSchema,
  })
  .strict();
export type CoordinatorHostUpMessage = z.infer<typeof coordinatorHostUpMessageSchema>;

export const coordinatorHostDownMessageSchema = z
  .object({
    type: z.literal("coordinator/hostDown"),
    hostId: nonEmptyStringSchema,
  })
  .strict();
export type CoordinatorHostDownMessage = z.infer<typeof coordinatorHostDownMessageSchema>;

export const coordinatorHostWorkspacesMessageSchema = z
  .object({
    type: z.literal("coordinator/hostWorkspaces"),
    hostId: nonEmptyStringSchema,
    workspaceKeys: z.array(nonEmptyStringSchema),
  })
  .strict();
export type CoordinatorHostWorkspacesMessage = z.infer<
  typeof coordinatorHostWorkspacesMessageSchema
>;

/** Host 上行帧原样封装；协调器侧严格校验 frame，非法帧丢弃并记日志。 */
export const coordinatorHostFrameMessageSchema = z
  .object({
    type: z.literal("coordinator/hostFrame"),
    hostId: nonEmptyStringSchema,
    frame: hostResponseMessageSchema,
  })
  .strict();
export type CoordinatorHostFrameMessage = z.infer<typeof coordinatorHostFrameMessageSchema>;

export const coordinatorShutdownMessageSchema = z
  .object({
    type: z.literal("coordinator/shutdown"),
  })
  .strict();
export type CoordinatorShutdownMessage = z.infer<typeof coordinatorShutdownMessageSchema>;

export const mainToCoordinatorMessageSchema = z.discriminatedUnion("type", [
  coordinatorHostUpMessageSchema,
  coordinatorHostDownMessageSchema,
  coordinatorHostWorkspacesMessageSchema,
  coordinatorHostFrameMessageSchema,
  coordinatorShutdownMessageSchema,
]);
export type MainToCoordinatorMessage = z.infer<typeof mainToCoordinatorMessageSchema>;

// ── Coordinator → Main ────────────────────────────────────────────

/** 仲裁后的 Host 下行帧；Main 仅按 hostId 查进程注册表转发，不解析 message。 */
export const coordinatorDeliverMessageSchema = z
  .object({
    type: z.literal("coordinator/deliver"),
    hostId: nonEmptyStringSchema,
    message: hostIncomingMessageSchema,
  })
  .strict();
export type CoordinatorDeliverMessage = z.infer<typeof coordinatorDeliverMessageSchema>;

export const coordinatorDiagnosticsMessageSchema = z
  .object({
    type: z.literal("coordinator/diagnostics"),
    diagnostics: z.record(nonEmptyStringSchema, z.number().int().nonnegative()),
  })
  .strict();
export type CoordinatorDiagnosticsMessage = z.infer<typeof coordinatorDiagnosticsMessageSchema>;

export const coordinatorLogMessageSchema = z
  .object({
    type: z.literal("coordinator/log"),
    level: z.enum(["info", "warn"]),
    message: nonEmptyStringSchema,
  })
  .strict();
export type CoordinatorLogMessage = z.infer<typeof coordinatorLogMessageSchema>;

export const coordinatorToMainMessageSchema = z.discriminatedUnion("type", [
  coordinatorDeliverMessageSchema,
  coordinatorDiagnosticsMessageSchema,
  coordinatorLogMessageSchema,
]);
export type CoordinatorToMainMessage = z.infer<typeof coordinatorToMainMessageSchema>;
