import { recordArmsCustomEventForE2E } from "@shucode/ui";
import {
  DesktopCommandIds,
  buildLocalMediaPreviewUrl,
  type IPlatformService,
} from "@shucode/shared";

import { desktopBrowserPlatformBridge } from "./desktopBrowserPlatformBridge.js";

export function createDesktopPlatform(options: {
  isLocalDevelopmentRuntime: boolean;
}): IPlatformService {
  return {
    canSelectFilePath: true,
    createLocalMediaPreviewUrl: buildLocalMediaPreviewUrl,
    isLocalDevelopmentRuntime: options.isLocalDevelopmentRuntime,
    selectDirectory: () => window.shucode.selectDirectory(),
    selectFile: () => window.shucode.selectFile(),
    selectFiles: () => window.shucode.selectFiles?.() ?? Promise.resolve([]),
    createTempTextAttachment: (payload) => window.shucode.createTempTextAttachment(payload),
    onRemoteConnectionLog: (handler) => window.shucode.onRemoteConnectionLog(handler),
    onRemoteSessionClosed: (handler) => window.shucode.onRemoteSessionClosed(handler),
    onBotRemoteWorkspaceReconnected: (handler) =>
      window.shucode.onBotRemoteWorkspaceReconnected(handler),
    activateOrSetWorkspace: (path) =>
      window.shucode.activateOrSetWorkspace?.(path) ?? Promise.resolve({ activated: false }),
    connectRemote: (remoteOptions, requestId, context) =>
      window.shucode.connectRemote(remoteOptions, requestId, context),
    cancelPendingRemoteConnection: (requestId) =>
      window.shucode.cancelPendingRemoteConnection?.(requestId) ?? Promise.resolve(),
    bindRemoteWorkspaceSessionContext: (context) =>
      window.shucode.bindRemoteWorkspaceSessionContext?.(context) ?? Promise.resolve(),
    disposeRemoteSession: (sessionId) => window.shucode.disposeRemoteSession(sessionId),
    isDockerAvailable: () => window.shucode.isDockerAvailable(),
    listWSLDistros: () => window.shucode.listWSLDistros(),
    listDockerContainers: () => window.shucode.listDockerContainers(),
    listSSHConfigAliases: () => window.shucode.listSSHConfigAliases(),
    loadMcpFromUserDirectory: (payload) => window.shucode.loadMcpFromUserDirectory(payload),
    saveMcpToUserDirectory: (payload) => window.shucode.saveMcpToUserDirectory(payload),
    migrateLegacyCommonMcp: (payload) => window.shucode.migrateLegacyCommonMcp(payload),
    openExternal: (url) => window.shucode.openExternal(url),
    openFeedback: () => window.shucode.executeDesktopCommand(DesktopCommandIds.OpenFeedback),
    openCommunity: () => window.shucode.executeDesktopCommand(DesktopCommandIds.OpenCommunity),
    canOpenCommunity: (locale) => window.shucode.canOpenCommunity(locale),
    openInFileManager: (path) => window.shucode.openInFileManager(path),
    openExternalFile: (path) => window.shucode.openExternalFile(path),
    openCuaPermissionOnboarding: window.shucode.openCuaPermissionOnboarding
      ? (permissionOptions) =>
          window.shucode.openCuaPermissionOnboarding?.(permissionOptions) ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    prepareCuaHelperPermissionDrag: window.shucode.prepareCuaHelperPermissionDrag
      ? () =>
          window.shucode.prepareCuaHelperPermissionDrag?.() ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    startCuaHelperPermissionDrag: window.shucode.startCuaHelperPermissionDrag
      ? () => window.shucode.startCuaHelperPermissionDrag?.()
      : undefined,
    registerOAuthState: (payload) => window.shucode.registerOAuthState(payload),
    onOAuthCallback: (callback) => window.shucode.onOAuthCallback(callback),
    onPaymentCallback: (callback) => window.shucode.onPaymentCallback(callback),
    onShareImport: (callback) => window.shucode.onShareImport?.(callback) ?? (() => {}),
    notifyRendererReady: () => window.shucode.notifyRendererReady(),
    reportTelemetryEvent: (payload) => window.shucode.reportTelemetryEvent(payload),
    reportArmsCustomEvent: (payload) => {
      recordArmsCustomEventForE2E(payload);
      return window.shucode.reportArmsCustomEvent(payload);
    },
    getRendererActionTraceConfig: window.shucode.getRendererActionTraceConfig
      ? () => window.shucode.getRendererActionTraceConfig!()
      : undefined,
    onRendererActionTraceConfigChanged: window.shucode.onRendererActionTraceConfigChanged
      ? (callback) => window.shucode.onRendererActionTraceConfigChanged!(callback)
      : undefined,
    reportLocalTtftBatch: (batch) => window.shucode.reportLocalTtftBatch(batch),
    reportRendererActionTraceBatch: window.shucode.reportRendererActionTraceBatch
      ? (batch) => window.shucode.reportRendererActionTraceBatch!(batch)
      : undefined,
    reportRendererHeapSample: window.shucode.reportRendererHeapSample
      ? (sample) => window.shucode.reportRendererHeapSample!(sample)
      : undefined,
    showTaskNotification: (payload) => window.shucode.showTaskNotification(payload),
    syncWindowTabs: (paths) => window.shucode.syncWindowTabs(paths),
    syncWindowUnreadCount: (count) => window.shucode.syncWindowUnreadCount(count),
    syncActiveTaskSession: (sessionId) => window.shucode.syncActiveTaskSession(sessionId),
    syncAppSettings: (patch) => window.shucode.syncAppSettings?.(patch),
    setShortcutRecordingActive: (active) => window.shucode.setShortcutRecordingActive?.(active),
    onFocusTab: (handler) => window.shucode.onFocusTab(handler),
    onNewTab: (handler) => window.shucode.onNewTab(handler),
    onCloseActiveContextRequest: (handler) =>
      window.shucode.onCloseActiveContextRequest?.(handler) ?? (() => {}),
    onOpenBrowserUrl: (handler) => window.shucode.onOpenBrowserUrl?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfacePrepare: (handler) =>
      window.shucode.onBrowserViewScreenshotSurfacePrepare?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfaceRelease: (handler) =>
      window.shucode.onBrowserViewScreenshotSurfaceRelease?.(handler) ?? (() => {}),
    browserViewScreenshotSurfaceReady: (payload) =>
      window.shucode.browserViewScreenshotSurfaceReady?.(payload),
    ...desktopBrowserPlatformBridge,
    onNewTask: (handler) => window.shucode.onNewTask(handler),
    onOpenWorkspace: (handler) => {
      // 开发态或升级后的旧窗口可能仍运行未暴露 onOpenWorkspace 的 preload，
      // renderer 直接调用会在启动时崩溃。这里和 activateOrSetWorkspace 一样做兼容兜底，
      // 缺少该 bridge 时只禁用原生菜单回调，不影响应用继续打开。
      return window.shucode.onOpenWorkspace?.(handler) ?? (() => {});
    },
    onOpenWorkspacePath: (handler) => window.shucode.onOpenWorkspacePath?.(handler) ?? (() => {}),
    onOpenFeedbackDialog: (handler) => window.shucode.onOpenFeedbackDialog?.(handler) ?? (() => {}),
    onOpenTicketsPanel: (handler) => window.shucode.onOpenTicketsPanel?.(handler) ?? (() => {}),
    onWindowFullscreenChanged: (handler) => window.shucode.onWindowFullscreenChanged(handler),
    getDesktopWindowChromeState: window.shucode.getDesktopWindowChromeState
      ? () => window.shucode.getDesktopWindowChromeState!()
      : undefined,
    onDesktopWindowChromeStateChanged: window.shucode.onDesktopWindowChromeStateChanged
      ? (handler) => window.shucode.onDesktopWindowChromeStateChanged!(handler)
      : undefined,
    getWindowControlsOverlayMetrics: () =>
      window.shucode.getWindowControlsOverlayMetrics?.() ?? null,
    onWindowControlsOverlayChanged: (handler) =>
      window.shucode.onWindowControlsOverlayChanged?.(handler) ?? (() => {}),
    getDesktopZoomLevel: () =>
      window.shucode.getDesktopZoomLevel?.() ?? Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: (handler) =>
      window.shucode.onDesktopZoomLevelChanged?.(handler) ?? (() => {}),
    onTaskNotificationClick: (handler) => window.shucode.onTaskNotificationClick(handler),
    exportLogs: () => window.shucode.exportLogs(),
    captureWindowScreenshot: () =>
      window.shucode.captureWindowScreenshot?.() ?? Promise.resolve(null),
    onUpdateReady: (callback) => window.shucode.onUpdateReady(callback),
    onUpdateCheckResult: (callback) => window.shucode.onUpdateCheckResult(callback),
    onUpdateStateChanged: (callback) =>
      window.shucode.onUpdateStateChanged?.(callback) ?? (() => {}),
    getUpdateState: () =>
      window.shucode.getUpdateState?.() ?? Promise.resolve({ kind: "idle", enabled: true }),
    downloadUpdate: () => window.shucode.downloadUpdate?.() ?? Promise.resolve(),
    cancelUpdateDownload: () => window.shucode.cancelUpdateDownload?.() ?? Promise.resolve(),
    openUpdateStatusWindow: () => window.shucode.openUpdateStatusWindow?.() ?? Promise.resolve(),
    getAutoUpdatePreferences: () =>
      window.shucode.getAutoUpdatePreferences?.() ??
      Promise.resolve({ autoDownloadAndInstallUpdates: false }),
    setAutoDownloadAndInstallUpdates: (enabled) =>
      window.shucode.setAutoDownloadAndInstallUpdates?.(enabled) ?? Promise.resolve(),
    getDesktopSessionActivity: () =>
      window.shucode.getDesktopSessionActivity?.() ??
      Promise.resolve({ runningAgentSessionCount: 0 }),
    getShucodeStdioTapDevState: () =>
      window.shucode.getShucodeStdioTapDevState?.() ??
      Promise.resolve({ enabled: false, visible: false, logDir: "", statePath: "" }),
    onSettingsChanged: (callback) => window.shucode.onSettingsChanged?.(callback) ?? (() => {}),
    onApplicationLocaleChanged: (callback) =>
      window.shucode.onApplicationLocaleChanged?.(callback) ?? (() => {}),
    onPostUpdateReleaseNotes: (callback) => window.shucode.onPostUpdateReleaseNotes(callback),
    acknowledgePostUpdateReleaseNotes: (version) =>
      window.shucode.acknowledgePostUpdateReleaseNotes(version),
    skipUpdateVersion: (version) =>
      window.shucode.skipUpdateVersion?.(version) ?? Promise.resolve(),
    quitAndInstallUpdate: () => window.shucode.quitAndInstallUpdate(),
    getInstalledEditors: () => window.shucode.getInstalledEditors(),
    getApplicationIcon: (bundleId) =>
      window.shucode.getApplicationIcon?.(bundleId) ?? Promise.resolve(null),
    openInEditor: (editorId, path, editorOptions) =>
      window.shucode.openInEditor(editorId, path, editorOptions),
    executeDesktopCommand: (command) => window.shucode.executeDesktopCommand(command),
    setApplicationLocale: (locale) => window.shucode.setApplicationLocale(locale),
    getSystemLocale: () =>
      window.shucode.getSystemLocale?.() ??
      Promise.resolve(navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"),
    setTitleBarTheme: (theme) => window.shucode.setTitleBarTheme(theme),
    getDeviceId: () =>
      (window as Window & { __SHUCODE_DEVICE_ID__?: string }).__SHUCODE_DEVICE_ID__ ?? "",
  };
}
