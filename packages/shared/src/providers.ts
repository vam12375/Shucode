import { z } from "zod";

/**
 * Shucode agent 提供方的单一真源。
 *
 * 类型 ShucodeProvider、运行时 schema shucodeProviderSchema 都从这里派生,
 * 避免各处内联 z.enum([...]) 副本随新增/删除 provider 漂移。
 * 本模块只依赖 zod(叶子),可被 validation / shucode-protocol 等无环引用。
 */
const SHUCODE_PROVIDERS = ["glm"] as const;

export const shucodeProviderSchema = z.enum(SHUCODE_PROVIDERS);

export type ShucodeProvider = (typeof SHUCODE_PROVIDERS)[number];
