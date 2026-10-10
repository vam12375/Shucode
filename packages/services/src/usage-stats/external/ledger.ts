import { createRequire } from "node:module";
import type { AppUsageDashboard, AppUsageRequest } from "@shucode/shared";
import type { ExternalUsageRecord } from "./types.js";
import { queryExternalUsage } from "./query.js";

// 遵循现有Repo入口，避免打包器将node:sqlite重写为npm sqlite模块。
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");
type UsageDatabase = InstanceType<typeof DatabaseSync>;

const USAGE_COLUMNS = `(
    id text primary key, client_id text not null, started_at integer not null,
    provider_id text, model_id text, query_source text not null, status text not null,
    retry_count integer not null, input_tokens integer not null, output_tokens integer not null,
    cache_read_tokens integer not null, cache_creation_tokens integer not null, total_tokens integer not null,
    duration_ms real, time_to_first_token_ms real, has_usage integer not null check(has_usage in (0,1)),
    native_cost_usd real
  )`;
const CREATE_SCHEMA = `
  create table if not exists external_usage ${USAGE_COLUMNS};
  create index if not exists external_usage_time_idx on external_usage(started_at, id);
  create index if not exists external_usage_client_model_idx on external_usage(client_id, provider_id, model_id, started_at);
  create table if not exists external_usage_file (file_key text primary key, fingerprint text not null);
`;
// Claude 的 provider message ID 可被多个会话副本引用；旧 partial 不能覆盖终态事实。
const updateUsage = (
  table: string,
) => `on conflict(id) do update set client_id=excluded.client_id, started_at=excluded.started_at,
  provider_id=excluded.provider_id, model_id=excluded.model_id, query_source=excluded.query_source,
  status=excluded.status, retry_count=excluded.retry_count, input_tokens=excluded.input_tokens,
  output_tokens=excluded.output_tokens, cache_read_tokens=excluded.cache_read_tokens,
  cache_creation_tokens=excluded.cache_creation_tokens, total_tokens=excluded.total_tokens,
  duration_ms=excluded.duration_ms, time_to_first_token_ms=excluded.time_to_first_token_ms,
  has_usage=excluded.has_usage, native_cost_usd=excluded.native_cost_usd
  where excluded.client_id<>'claude-code'
    or (excluded.status<>'unknown') > (${table}.status<>'unknown')
    or ((excluded.status<>'unknown') = (${table}.status<>'unknown')
      and excluded.output_tokens >= ${table}.output_tokens)`;

export class ExternalUsageLedger {
  private readonly db: UsageDatabase;
  private fileScanActive = false;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    try {
      this.db.exec("pragma busy_timeout=5000; pragma journal_mode=wal;");
      this.db.exec(CREATE_SCHEMA);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  upsert(records: readonly ExternalUsageRecord[]): void {
    this.commit(records);
  }

  commitFile(key: string, fingerprint: string, records: readonly ExternalUsageRecord[]): void {
    this.commit(records, { key, fingerprint });
  }

  beginFileScan(): void {
    if (this.fileScanActive) throw new Error("An external usage file scan is already active");
    this.db.exec(
      `create temp table if not exists external_usage_stage ${USAGE_COLUMNS}; delete from external_usage_stage;`,
    );
    this.fileScanActive = true;
  }

  stageFileRecords(records: readonly ExternalUsageRecord[]): void {
    if (!this.fileScanActive) throw new Error("No external usage file scan is active");
    this.write(records, "external_usage_stage");
  }

  commitFileScan(key: string, fingerprint: string): void {
    if (!this.fileScanActive) throw new Error("No external usage file scan is active");
    this.db.exec("begin immediate");
    try {
      // 临时投影可流式落批，完整文件解析成功后才原子写入事实与指纹。
      this.db.exec(
        `insert into external_usage select * from external_usage_stage where true ${updateUsage("external_usage")}`,
      );
      this.setFileFingerprint(key, fingerprint);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    } finally {
      this.abortFileScan();
    }
  }

  abortFileScan(): void {
    if (this.fileScanActive) this.db.exec("delete from external_usage_stage");
    this.fileScanActive = false;
  }

  hasClientData(clientId: string): boolean {
    return (
      this.db.prepare("select 1 from external_usage where client_id=? limit 1").get(clientId) !==
      undefined
    );
  }

  private commit(
    records: readonly ExternalUsageRecord[],
    file?: { key: string; fingerprint: string },
  ): void {
    this.db.exec("begin immediate");
    try {
      this.write(records);
      if (file) this.setFileFingerprint(file.key, file.fingerprint);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  private write(records: readonly ExternalUsageRecord[], table = "external_usage"): void {
    const insert = this.db.prepare(
      `insert into ${table} values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ${updateUsage(table)}`,
    );
    for (const record of records)
      insert.run(
        record.id,
        record.clientId,
        record.startedAt,
        record.providerId,
        record.modelId,
        record.querySource,
        record.status,
        record.retryCount,
        record.inputTokens,
        record.outputTokens,
        record.cacheReadTokens,
        record.cacheCreationTokens,
        record.totalTokens,
        record.durationMs,
        record.timeToFirstTokenMs,
        record.hasUsage ? 1 : 0,
        record.nativeCostUSD ?? null,
      );
  }

  getFileFingerprint(key: string): string | undefined {
    const row = this.db
      .prepare("select fingerprint from external_usage_file where file_key=?")
      .get(key);
    return row ? String(row.fingerprint) : undefined;
  }

  setFileFingerprint(key: string, fingerprint: string): void {
    this.db
      .prepare(
        "insert into external_usage_file values(?,?) on conflict(file_key) do update set fingerprint=excluded.fingerprint",
      )
      .run(key, fingerprint);
  }

  query(request: AppUsageRequest): AppUsageDashboard {
    return queryExternalUsage(this.db, request);
  }

  close(): void {
    this.db.close();
  }
}
