import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Logger, SkillRoot } from "@shucode/contracts";
import { DYNAMIC_WORKFLOW_SKILL_NAME } from "@shucode/contracts";
import { candidateBaseDirs } from "./bundled-plugins.js";

/**
 * 随 CLI 内置的技能包（apps/shucode-cli/packages/bundled-skills）。
 *
 * 它不是插件：不进官方市场目录、没有启停开关、不能卸载，也不出现在设置页与 `$` 引用面板。
 * 产品功能的工具由 runtime 注册，配套技能随 CLI 分发，避免卸载插件后缺少工具使用说明。
 *
 * 两种运行形态解析到同一个 skills 目录：
 * - 开发态 / Electron 桌面：沿官方插件同款候选目录在入口旁找到 `packages/bundled-skills`，原地读取，不拷贝。
 * - 远端主机：prepare-prebuilds 把目录 stage 到远端 shucode.cjs 旁，与桌面同路。
 */

export const BUNDLED_SKILL_PACK_DIRECTORY_NAME = "bundled-skills";
export const BUNDLED_SKILL_PACK_SKILLS_DIRECTORY = "skills";
/** 门与技能包共用一个名字：常量住在 contracts（core 的技能门也读它），这里只转出。 */
export { DYNAMIC_WORKFLOW_SKILL_NAME };

/** 技能包里每个文件都是必需资产：丢任何一个都拒绝整包，而不是装出一个引用文件缺失的技能。 */
export const BUNDLED_SKILL_PACK_REQUIRED_PATHS = [
  `skills/${DYNAMIC_WORKFLOW_SKILL_NAME}/SKILL.md`,
  `skills/${DYNAMIC_WORKFLOW_SKILL_NAME}/patterns.md`,
  `skills/${DYNAMIC_WORKFLOW_SKILL_NAME}/examples.md`,
] as const;

/** 与 official-plugin-definitions 的 rootCandidates 同形，覆盖 monorepo src/dist、cli/dist 与桌面 resources/glm 布局。 */
const BUNDLED_SKILL_PACK_ROOT_CANDIDATES = [
  `packages/${BUNDLED_SKILL_PACK_DIRECTORY_NAME}`,
  `../${BUNDLED_SKILL_PACK_DIRECTORY_NAME}`,
  `../../${BUNDLED_SKILL_PACK_DIRECTORY_NAME}`,
  `../../../${BUNDLED_SKILL_PACK_DIRECTORY_NAME}`,
] as const;

/**
 * 排在所有插件根之后（adapters 的插件根从 FIRST_PLUGIN_PRIORITY 起步进）：同名技能按发现顺序取先者，
 * 用户/项目/插件里的同名技能都应压过内置包。
 */
const BUNDLED_SKILL_ROOT_PRIORITY = 1_000_000;

export interface ResolveBundledSkillRootsOptions {
  logger?: Logger;
}

export async function resolveBundledSkillRoots(
  options: ResolveBundledSkillRootsOptions,
): Promise<SkillRoot[]> {
  const packRoot = await resolveFilesystemBundledSkillPackRoot();
  if (!packRoot) {
    // 内置技能包缺席会让脚本编写被技能门拒绝；记录诊断，便于定位不完整的分发资产。
    options.logger?.warn("Bundled skill pack unavailable", {
      module: "bootstrap.bundled_skills",
      requiredPaths: [...BUNDLED_SKILL_PACK_REQUIRED_PATHS],
    });
    return [];
  }
  return [
    {
      path: join(packRoot, BUNDLED_SKILL_PACK_SKILLS_DIRECTORY),
      priority: BUNDLED_SKILL_ROOT_PRIORITY,
      scope: "system",
      source: "bundled",
    },
  ];
}

export async function findMissingBundledSkillPackPaths(packRoot: string): Promise<string[]> {
  const present = await Promise.all(
    BUNDLED_SKILL_PACK_REQUIRED_PATHS.map((requiredPath) =>
      pathExists(join(packRoot, ...requiredPath.split("/"))),
    ),
  );
  return BUNDLED_SKILL_PACK_REQUIRED_PATHS.filter((_, index) => !present[index]);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveFilesystemBundledSkillPackRoot(): Promise<string | undefined> {
  for (const baseDir of candidateBaseDirs()) {
    for (const relativePath of BUNDLED_SKILL_PACK_ROOT_CANDIDATES) {
      const packRoot = resolve(baseDir, relativePath);
      if (
        (await pathExists(join(packRoot, BUNDLED_SKILL_PACK_SKILLS_DIRECTORY))) &&
        (await findMissingBundledSkillPackPaths(packRoot)).length === 0
      ) {
        return packRoot;
      }
    }
  }
  return undefined;
}
