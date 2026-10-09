import type { ShucodeSessionFile, ShucodeTaskMeta } from "@shucode/shared";
import {
  shucodeSessionFileSchema,
  shucodeTaskMetaSchema,
  shucodeTaskModeSchema,
} from "@shucode/shared";

export type LegacyTaskSessionFile = Omit<ShucodeSessionFile, "meta"> & {
  meta: Omit<ShucodeTaskMeta, "mode"> & { mode?: ShucodeTaskMeta["mode"] };
};

const legacyTaskSessionFileSchema = shucodeSessionFileSchema.extend({
  // Claude 原生迁移会按清洗路径删除 meta.mode。
  // legacy snapshot 读取/写入仍要校验其它必需字段，但不能再强制把被过滤字段补回文件。
  meta: shucodeTaskMetaSchema.extend({
    mode: shucodeTaskModeSchema.optional(),
  }),
});

export function parseLegacyTaskSessionFile(input: unknown): LegacyTaskSessionFile {
  return legacyTaskSessionFileSchema.parse(input);
}

export function safeParseLegacyTaskSessionFile(input: unknown) {
  return legacyTaskSessionFileSchema.safeParse(input);
}
