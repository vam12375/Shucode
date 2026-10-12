// scripts/desktop-product-identity.mjs 的类型声明（.mjs 无类型，main 的 tsconfig
// allowJs:false 下直接 import 会 TS7016；同目录 target-platform.d.mts / powershell-command.d.mts 先例）。
// 只声明 main 编译所需的导出；新增导出时同步补充。

export interface DesktopProductIdentity {
  flavor: "production" | "preview";
  appId: string;
  productName: string;
  linuxExecutableName: string;
  linuxPackageName: string;
  cuaHelperInstallVariant: string | null;
}

export const SHUCODE_PREVIEW_IDENTITY_ENV: "SHUCODE_PREVIEW_IDENTITY";
export const desktopProductIdentities: Readonly<{
  production: DesktopProductIdentity;
  preview: DesktopProductIdentity;
}>;
export function isPreviewIdentityRequested(env?: NodeJS.ProcessEnv): boolean;
export function resolveDesktopProductFlavor(env?: NodeJS.ProcessEnv): "production" | "preview";
export function resolveDesktopProductIdentity(env?: NodeJS.ProcessEnv): DesktopProductIdentity;
export function resolveDesktopArtifactSuffix(env?: NodeJS.ProcessEnv): string;
export function resolveWindowsAppUserModelIdForFlavor(
  flavor: string,
  runtime?: { isPackaged?: boolean },
): string;
export function resolveWindowsAppUserModelId(
  env?: NodeJS.ProcessEnv,
  runtime?: { isPackaged?: boolean },
): string;
