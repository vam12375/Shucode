import { useCallback, useEffect, useRef, useState } from "react";
import type { AppUsageRange, AppUsageRequest, AppUsageSnapshot } from "@shucode/shared";
import type { IUsageStatsService } from "@shucode/services";
import { logger } from "@/logger.js";
import { useServices } from "@/hooks/useServices.js";

interface AppUsageStatsState {
  snapshot: AppUsageSnapshot | null;
  loading: boolean;
  error: string | null;
  queryKey: string;
  service: IUsageStatsService;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || String(error);
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return String(error);
}

export function useAppUsageStats(
  range: AppUsageRange,
  options?: {
    dashboard?: AppUsageRequest["dashboard"];
    since?: number;
    until?: number;
    autoRefreshMs?: number;
  },
) {
  const { usageStatsService } = useServices();
  const queryKey = JSON.stringify({
    range,
    since: options?.since,
    until: options?.until,
    dashboard: options?.dashboard,
  });
  const [state, setState] = useState<AppUsageStatsState>({
    snapshot: null,
    loading: false,
    error: null,
    queryKey,
    service: usageStatsService,
  });
  const requestVersionRef = useRef(0);
  const syncSourcesOnNextQueryRef = useRef(false);
  const pendingRef = useRef<{
    queryKey: string;
    service: IUsageStatsService;
    promise: Promise<void>;
  } | null>(null);

  const refresh = useCallback(
    (force = false, syncSources = false): Promise<void> => {
      const pending = pendingRef.current;
      if (!force && pending?.queryKey === queryKey && pending.service === usageStatsService) {
        return pending.promise;
      }
      const requestVersion = requestVersionRef.current + 1;
      requestVersionRef.current = requestVersion;
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setState((current) => ({
        snapshot:
          current.queryKey === queryKey && current.service === usageStatsService
            ? current.snapshot
            : null,
        loading: true,
        error: null,
        queryKey,
        service: usageStatsService,
      }));
      const promise = (async () => {
        try {
          const request = JSON.parse(queryKey) as AppUsageRequest;
          if (syncSources && request.dashboard) request.dashboard.syncSources = true;
          const snapshot = await usageStatsService.getAppUsageSnapshot({ ...request, timeZone });
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          setState({ snapshot, loading: false, error: null, queryKey, service: usageStatsService });
        } catch (error) {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          const message = getErrorMessage(error);
          logger.warn("[useAppUsageStats] 读取本地使用统计失败", {
            range,
            timeZone,
            error: message,
          });
          setState((current) => ({
            snapshot: current.snapshot,
            loading: false,
            error: message,
            queryKey,
            service: usageStatsService,
          }));
        }
      })();
      pendingRef.current = { queryKey, service: usageStatsService, promise };
      void promise.then(() => {
        if (pendingRef.current?.promise === promise) pendingRef.current = null;
      });
      return promise;
    },
    [queryKey, range, usageStatsService],
  );

  useEffect(() => {
    const syncSources = syncSourcesOnNextQueryRef.current;
    syncSourcesOnNextQueryRef.current = false;
    void refresh(false, syncSources);
    return () => {
      requestVersionRef.current += 1;
      pendingRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = async () => {
      await refresh();
      // 轮询在读取完成后调度，慢查询不会叠加；切换 Environment / 查询后旧响应立即失效。
      if (active && options?.autoRefreshMs)
        timer = setTimeout(() => void update(), options.autoRefreshMs);
    };
    void update();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [refresh, options?.autoRefreshMs]);

  const sameScope = state.queryKey === queryKey && state.service === usageStatsService;
  return {
    snapshot: sameScope ? state.snapshot : null,
    loading: sameScope ? state.loading : true,
    error: sameScope ? state.error : null,
    refresh,
    refreshOnNextQuery: (syncSources: boolean) => {
      syncSourcesOnNextQueryRef.current = syncSources;
    },
  };
}

// 二开定制：官方套餐（编程套餐）使用统计读取已下线，仅保留应用用量统计。
