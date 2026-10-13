import type { RuntimeInfo } from "@shucode/shared-types";

export { type RuntimeInfo };

export const getRuntimeInfo = (): RuntimeInfo => ({
  arch: process.arch,
  cwd: process.cwd(),
  execPath: process.execPath,
  node: process.version,
  platform: process.platform,
  versions: process.versions,
});
