import {
  collectVisibleShucodeBackgroundTaskControlItems,
  getShucodeBackgroundTaskControlItemElapsedMs,
  isActiveShucodeBackgroundTaskControlItem,
  parseShucodeBackgroundTaskControlItems,
  type ShucodeBackgroundTaskControlItem,
  type ShucodeBackgroundTaskControlStatus,
} from "./background-task-controls.js";

export type ShucodeBackgroundBashJobStatus = ShucodeBackgroundTaskControlStatus;
export type ShucodeBackgroundBashJob = ShucodeBackgroundTaskControlItem & {
  taskKind: "bash";
};

export function parseShucodeBackgroundBashJobs(value: unknown): ShucodeBackgroundBashJob[] {
  return parseShucodeBackgroundTaskControlItems(value).filter(isBackgroundBashJob);
}

export function isActiveShucodeBackgroundBashJob(job: ShucodeBackgroundBashJob): boolean {
  return isActiveShucodeBackgroundTaskControlItem(job);
}

export function getShucodeBackgroundBashJobElapsedMs(
  job: ShucodeBackgroundBashJob,
  now = Date.now(),
): number {
  return getShucodeBackgroundTaskControlItemElapsedMs(job, now);
}

export function collectVisibleShucodeBackgroundBashJobs(
  jobs: readonly ShucodeBackgroundBashJob[],
  now = Date.now(),
  thresholdMs = 30_000,
): Array<ShucodeBackgroundBashJob & { elapsedMs: number }> {
  return collectVisibleShucodeBackgroundTaskControlItems(jobs, now, thresholdMs) as Array<
    ShucodeBackgroundBashJob & { elapsedMs: number }
  >;
}

function isBackgroundBashJob(
  job: ShucodeBackgroundTaskControlItem,
): job is ShucodeBackgroundBashJob {
  return job.taskKind === "bash";
}
