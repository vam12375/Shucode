import type { ShucodeBackgroundTaskControlItem } from "./background-task-controls.js";

export function mergeShucodeBackgroundTaskControlItems(
  current: readonly ShucodeBackgroundTaskControlItem[],
  updates: readonly ShucodeBackgroundTaskControlItem[],
): ShucodeBackgroundTaskControlItem[] {
  const jobsById = new Map(current.map((job) => [job.jobId, job] as const));
  for (const job of updates) {
    jobsById.set(job.jobId, job);
  }
  return Array.from(jobsById.values());
}
