import { useCallback, useEffect, useRef, useState } from "react";
import type { UsagePricingSettings } from "@shucode/shared";
import type { IUsageStatsService } from "@shucode/services";
import { useServices } from "./useServices.js";
import { logger } from "@/logger.js";

export const USAGE_PRICING_METHOD_NOT_FOUND = "usagePricing.methodNotFound";

export function useUsagePricing(onChanged: () => Promise<void>) {
  const { usageStatsService } = useServices();
  const [state, setState] = useState<{
    settings: UsagePricingSettings | null;
    service: IUsageStatsService;
    busy: boolean;
    error: string | null;
  }>({ settings: null, service: usageStatsService, busy: true, error: null });
  const version = useRef(0);
  const pending = useRef(false);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const run = useCallback(
    async (
      operation: (service: IUsageStatsService) => Promise<UsagePricingSettings>,
      changed = true,
      method?: string,
    ) => {
      if (pending.current) return false;
      pending.current = true;
      const currentVersion = version.current;
      setState((current) => ({ ...current, service: usageStatsService, busy: true, error: null }));
      try {
        const settings = await operation(usageStatsService);
        if (version.current !== currentVersion) return false;
        setState({ settings, service: usageStatsService, busy: changed, error: null });
        if (changed) await onChangedRef.current();
        if (version.current !== currentVersion) return false;
        setState({ settings, service: usageStatsService, busy: false, error: null });
        return true;
      } catch (error) {
        if (version.current !== currentVersion) return false;
        const errorCode =
          typeof error === "object" && error !== null && "code" in error
            ? (error as { code?: unknown }).code
            : null;
        const methodNotFoundMessage =
          error instanceof Error &&
          error.message.includes("Method not found: importCcSwitchPrices");
        const message =
          method === "importCcSwitchPrices" && (errorCode === -32601 || methodNotFoundMessage)
            ? USAGE_PRICING_METHOD_NOT_FOUND
            : error instanceof Error
              ? error.message
              : String(error);
        logger.warn("[useUsagePricing] 模型定价操作失败", {
          error: error instanceof Error ? error.message : String(error),
          code: errorCode,
        });
        setState((current) => ({
          ...current,
          busy: false,
          error: message,
        }));
        return false;
      } finally {
        if (version.current === currentVersion) pending.current = false;
      }
    },
    [usageStatsService],
  );

  useEffect(() => {
    version.current += 1;
    pending.current = false;
    setState({ settings: null, service: usageStatsService, busy: true, error: null });
    void run((service) => service.getPricing(), false);
    return () => {
      version.current += 1;
      pending.current = false;
    };
  }, [usageStatsService, run]);

  const sameService = state.service === usageStatsService;
  return {
    settings: sameService ? state.settings : null,
    busy: !sameService || state.busy,
    error: sameService ? state.error : null,
    run,
  };
}
