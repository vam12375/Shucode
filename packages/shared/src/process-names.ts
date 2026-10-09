const SHUCODE_PROCESS_PREFIX = "shucode";
const MAX_PROCESS_NAME_SEGMENT_LENGTH = 24;

function sanitizeProcessNameSegment(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_PROCESS_NAME_SEGMENT_LENGTH);
}

function joinShucodeProcessName(...segments: Array<string | null | undefined>): string {
  const sanitizedSegments = segments
    .map((segment) => sanitizeProcessNameSegment(segment))
    .filter((segment): segment is string => Boolean(segment));
  return [SHUCODE_PROCESS_PREFIX, ...sanitizedSegments].join("-");
}

function pickWorkspaceTag(workspacePath: string | null | undefined): string | undefined {
  const trimmedPath = workspacePath?.trim();
  if (!trimmedPath) {
    return undefined;
  }

  const parts = trimmedPath.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? trimmedPath;
}

export function formatShucodeMainProcessName(): string {
  return joinShucodeProcessName("main");
}

export function formatShucodeGpuProcessName(): string {
  return joinShucodeProcessName("gpu");
}

export function formatShucodeHostProcessName(label?: string): string {
  return joinShucodeProcessName("host", label);
}

export function formatShucodeRendererProcessName(windowTitle?: string): string {
  const normalizedTitle = windowTitle?.trim();
  if (!normalizedTitle || normalizedTitle === "Shucode") {
    return joinShucodeProcessName("renderer", "main");
  }

  if (normalizedTitle === "Resource Manager") {
    return joinShucodeProcessName("renderer", "resource-manager");
  }

  const remoteWindowPrefix = "Shucode - ";
  if (normalizedTitle.startsWith(remoteWindowPrefix)) {
    return joinShucodeProcessName(
      "renderer",
      "remote",
      normalizedTitle.slice(remoteWindowPrefix.length),
    );
  }

  return joinShucodeProcessName("renderer", normalizedTitle);
}

export function formatShucodeAgentProcessName(provider: string, workspacePath?: string): string {
  return joinShucodeProcessName("agent", provider, pickWorkspaceTag(workspacePath));
}

export function formatShucodeUtilityProcessName(name?: string, type = "utility"): string {
  return joinShucodeProcessName(type, name);
}
