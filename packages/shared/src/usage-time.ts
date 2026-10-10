import type { AppUsageRange } from "./usage-stats.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let result = dateFormatters.get(timeZone);
  if (!result) {
    result = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    if (dateFormatters.size > 64) dateFormatters.clear();
    dateFormatters.set(timeZone, result);
  }
  return result;
}

function localParts(
  at: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  return Object.fromEntries(
    formatter(timeZone)
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

export function usageBucket(at: number, timeZone: string, hourly: boolean): string {
  const parts = localParts(at, timeZone);
  const date = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  if (!hourly) return date;
  const localUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsetMinutes = Math.round((localUtc - Math.trunc(at / 1000) * 1000) / 60_000);
  const absolute = Math.abs(offsetMinutes);
  const offset = `${offsetMinutes < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return `${date}T${String(parts.hour).padStart(2, "0")}:00${offset}`;
}

function dateStart(date: string, timeZone: string): number {
  const approximate = Date.parse(`${date}T00:00:00Z`);
  let lower = approximate - 2 * DAY_MS;
  let upper = approximate + 2 * DAY_MS;
  // 找第一个本地日历瞬间，避免当前固定偏移在 DST 历史边界算错。
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (usageBucket(middle, timeZone, false) < date) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

export function resolveDashboardRange(
  range: AppUsageRange,
  timeZone: string,
  until: number,
  customSince?: number,
): { since: number; until: number } {
  if (range === "custom") {
    if (
      customSince === undefined ||
      !Number.isFinite(customSince) ||
      customSince < 0 ||
      customSince > until
    )
      throw new RangeError("Custom usage range requires since <= until");
    return { since: customSince, until };
  }
  if (range === "24h") return { since: Math.max(0, until - DAY_MS), until };
  const today = usageBucket(until, timeZone, false);
  const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "30d" ? 30 : 1;
  const firstDate = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return { since: range === "all" ? 0 : dateStart(firstDate, timeZone), until };
}

export function isHourlyDashboard(range: AppUsageRange, since: number, until: number): boolean {
  return range === "today" || range === "24h" || (range === "custom" && until - since <= DAY_MS);
}

export function dashboardBuckets(
  since: number,
  until: number,
  timeZone: string,
  hourly: boolean,
): string[] {
  const buckets = new Set<string>();
  if (hourly) {
    let previousAt = since;
    let previousBucket = usageBucket(since, timeZone, true);
    buckets.add(previousBucket);
    const addInterval = (end: number) => {
      const endBucket = usageBucket(end, timeZone, true);
      if (previousBucket.slice(-6) !== endBucket.slice(-6)) {
        // 半小时 DST 回拨产生短于一小时的重复桶，整点采样会漏掉该桶的真实用量。
        let lower = previousAt;
        let upper = end;
        const oldOffset = previousBucket.slice(-6);
        while (lower < upper) {
          const middle = Math.floor((lower + upper) / 2);
          if (usageBucket(middle, timeZone, true).slice(-6) === oldOffset) lower = middle + 1;
          else upper = middle;
        }
        buckets.add(usageBucket(lower, timeZone, true));
      }
      buckets.add(endBucket);
      previousAt = end;
      previousBucket = endBucket;
    };
    for (let at = since + HOUR_MS; at <= until; at += HOUR_MS) addInterval(at);
    if (previousAt < until) addInterval(until);
  } else {
    const end = usageBucket(until, timeZone, false);
    for (let date = usageBucket(since, timeZone, false); date <= end; ) {
      buckets.add(date);
      date = new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
    }
  }
  return [...buckets];
}
