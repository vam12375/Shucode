import { z } from "zod";
import { usageModelPriceSchema } from "./usage-pricing.js";

export const APP_USAGE_STATUSES = ["completed", "error", "cancelled"] as const;
export const USAGE_CLIENT_IDS = [
  "shucode",
  "codex",
  "claude-code",
  "dsh-desktop",
  "pi",
  "gemini",
  "opencode",
  "grok-build",
  "minimax-code",
] as const;
export const usageCursorSchema = z.object({
  startedAt: z.number().int().nonnegative(),
  id: z.string().max(1024),
});
export type UsageCursor = z.infer<typeof usageCursorSchema>;
export const appUsageDashboardQuerySchema = z.object({
  scope: z.enum(["shucode", "all-clients"]).default("shucode"),
  clientId: z.enum(USAGE_CLIENT_IDS).optional(),
  syncSources: z.boolean().optional(),
  providerId: z.string().max(256).optional(),
  modelId: z.string().max(256).optional(),
  status: z.enum(APP_USAGE_STATUSES).optional(),
  page: z.number().int().nonnegative().default(0),
  pageSize: z.number().int().min(1).max(100).default(20),
  until: z.number().int().nonnegative().optional(),
  after: usageCursorSchema.optional(),
  prices: z.array(usageModelPriceSchema).max(2000).default([]),
});
export type AppUsageDashboardQuery = z.infer<typeof appUsageDashboardQuerySchema>;

export const appUsageMetricsSchema = z.object({
  requestCount: z.number().int().nonnegative(),
  totalTokens: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheCreationTokens: z.number().nonnegative(),
  cacheHitRate: z.number().nonnegative(),
  costUSD: z.number().finite().nonnegative().nullable(),
  unpricedCount: z.number().int().nonnegative(),
});
export type AppUsageMetrics = z.infer<typeof appUsageMetricsSchema>;

export const appUsageRequestLogSchema = z.object({
  clientId: z.string().default("shucode"),
  id: z.string(),
  startedAt: z.number(),
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
  querySource: z.string(),
  status: z.string(),
  retryCount: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheCreationTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  durationMs: z.number().nullable(),
  timeToFirstTokenMs: z.number().nullable(),
  costUSD: z.number().finite().nonnegative().nullable(),
  costSource: z.enum(["estimated", "client-reported"]).optional(),
});
export type AppUsageRequestLog = z.infer<typeof appUsageRequestLogSchema>;

export const appUsageDashboardSchema = z.object({
  summary: appUsageMetricsSchema,
  providers: z.array(appUsageMetricsSchema.extend({ providerId: z.string().nullable() })),
  models: z.array(
    appUsageMetricsSchema.extend({
      providerId: z.string().nullable(),
      modelId: z.string().nullable(),
    }),
  ),
  trend: z.array(appUsageMetricsSchema.extend({ bucket: z.string() })),
  heatmap: z.array(appUsageMetricsSchema.extend({ bucket: z.string() })).default([]),
  clientOptions: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        available: z.boolean(),
        error: z.string().optional(),
      }),
    )
    .default([]),
  sourceErrors: z.array(z.object({ clientId: z.string(), message: z.string() })).default([]),
  providerOptions: z.array(z.string()),
  modelOptions: z.array(z.string()),
  logs: z.array(appUsageRequestLogSchema).max(100),
  pagination: z.object({
    page: z.number().int().nonnegative(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    until: z.number(),
    nextCursor: usageCursorSchema.optional(),
  }),
});
export type AppUsageDashboard = z.infer<typeof appUsageDashboardSchema>;
