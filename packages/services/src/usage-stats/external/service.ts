import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppUsageDashboard, AppUsageRequest } from "@shucode/shared";
import { getAppConfigDir } from "../../paths.js";
import { ExternalUsageLedger } from "./ledger.js";
import { scanExternalUsage } from "./scanner.js";
import { defaultUsageRoots, type UsageSourceRoot } from "./sourceFiles.js";
import type { ExternalSourceStatus } from "./types.js";

export interface ExternalUsageService {
  getDashboard(request: AppUsageRequest): Promise<AppUsageDashboard>;
  dispose(): Promise<void>;
}

export function createExternalUsageService(
  options: {
    dbPath?: string;
    sources?: readonly UsageSourceRoot[];
    now?: () => number;
    beforeOpen?: Promise<void>;
  } = {},
): ExternalUsageService {
  const path = options.dbPath ?? join(getAppConfigDir(), "external-usage.sqlite");
  const sources = options.sources ?? defaultUsageRoots();
  const now = options.now ?? Date.now;
  let ledger: ExternalUsageLedger | undefined;
  let opening: Promise<ExternalUsageLedger> | undefined;
  let syncing: Promise<void> | undefined;
  let lastSync: number | undefined;
  let statuses: ExternalSourceStatus[] = sources.map((source) => ({
    id: source.id,
    label: source.label,
    available: false,
  }));
  let disposed = false;
  async function open(): Promise<ExternalUsageLedger> {
    if (disposed) throw new Error("Usage service is disposed");
    opening ??= (async () => {
      await options.beforeOpen;
      if (path !== ":memory:") await mkdir(dirname(path), { recursive: true });
      if (disposed) throw new Error("Usage service is disposed");
      ledger = new ExternalUsageLedger(path);
      return ledger;
    })().catch((error) => {
      opening = undefined;
      throw error;
    });
    return opening;
  }
  return {
    async getDashboard(request) {
      const db = await open();
      // open 的异步恢复可能晚于关闭；已关闭后不能再用句柄启动文件扫描。
      if (disposed) throw new Error("Usage service is disposed");
      if (
        !syncing &&
        (request.dashboard?.syncSources || lastSync === undefined || now() - lastSync >= 60_000)
      ) {
        syncing = (async () => {
          statuses = await scanExternalUsage(db, sources);
          lastSync = now();
        })().finally(() => {
          syncing = undefined;
        });
      }
      await syncing;
      if (disposed) throw new Error("Usage service is disposed");
      const dashboard = db.query(request);
      return {
        ...dashboard,
        clientOptions: statuses,
        sourceErrors: statuses.flatMap((source) =>
          source.error ? [{ clientId: source.id, message: source.error }] : [],
        ),
      };
    },
    async dispose() {
      disposed = true;
      await opening?.catch(() => undefined);
      await syncing?.catch(() => undefined);
      ledger?.close();
      ledger = undefined;
    },
  };
}

const owners = new Map<string, { service: ExternalUsageService; references: number }>();
const closing = new Map<string, Promise<void>>();

/** 同一 Host 的服务集合共享外部账本采集 owner，最后释放者关闭 SQLite。 */
export function acquireExternalUsageService(): {
  service: ExternalUsageService;
  release(): Promise<void>;
} {
  const key = join(getAppConfigDir(), "external-usage.sqlite");
  let owner = owners.get(key);
  if (!owner) {
    owner = {
      service: createExternalUsageService({ dbPath: key, beforeOpen: closing.get(key) }),
      references: 0,
    };
    owners.set(key, owner);
  }
  owner.references++;
  const held = owner;
  let released = false;
  return {
    service: held.service,
    async release() {
      if (released) return;
      released = true;
      if (--held.references === 0) {
        if (owners.get(key) === held) owners.delete(key);
        // 新 Host 可先建立服务，但须等旧扫描 owner 关闭，不能同时写同一个账本。
        const completion = held.service.dispose();
        closing.set(key, completion);
        try {
          await completion;
        } finally {
          if (closing.get(key) === completion) closing.delete(key);
        }
      }
    },
  };
}
