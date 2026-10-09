import {
  ProviderConfigService,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@shucode/provider";
import { NodeShucodeBuiltinProviderConfigSource } from "./shucode-builtin-provider-config-source.js";
import {
  EndpointScopedShucodeBuiltinSource,
  type EndpointScopedShucodeBuiltinSourceOptions,
} from "./endpoint-scoped-shucode-builtin-source.js";
import {
  ShucodeBuiltinRemoteSynchronizer,
  type ShucodeBuiltinRemoteSynchronizerOptions,
  type ShucodeBuiltinRefreshResult,
} from "./shucode-builtin-remote-synchronizer.js";
import {
  NodePersonalProviderConfigRepository,
  type PersonalProviderConfigRecoveryEvent,
} from "./personal-provider-config-repository.js";

export interface NodeProviderConfigRuntimeOptions {
  readonly shucodeBuiltinFilePath: string;
  readonly shucodeBuiltinActiveFilePath?: string;
  readonly shucodeBuiltinRemote?: Omit<ShucodeBuiltinRemoteSynchronizerOptions, "source">;
  readonly shucodeBuiltinEnvironment?: Omit<
    EndpointScopedShucodeBuiltinSourceOptions,
    "bundledFilePath"
  >;
  readonly onShucodeBuiltinRefreshError?: (error: unknown) => void;
  readonly onPersonalConfigRecovery?: (event: PersonalProviderConfigRecoveryEvent) => void;
  readonly onPersonalConfigPollingError?: (error: unknown) => void;
  readonly personalFilePath: string;
  readonly personalPollingIntervalMs?: number | false;
  readonly importLegacy?: (
    shucodeBuiltin: ProviderConfigLayerSnapshot,
  ) => Promise<ProviderConfigLayerUpdate | null>;
  readonly watch?: boolean;
}

/** 组装一个 Node.js 进程内共享的 Shucode Built-in/Personal Config 运行边界。 */
export class NodeProviderConfigRuntime {
  readonly configService: ProviderConfigService;
  readonly #shucodeBuiltinSource:
    | NodeShucodeBuiltinProviderConfigSource
    | EndpointScopedShucodeBuiltinSource;
  readonly #personalRepository: NodePersonalProviderConfigRepository;
  readonly #remoteSynchronizer?: ShucodeBuiltinRemoteSynchronizer;
  readonly #onRemoteRefreshError?: (error: unknown) => void;
  #startPromise: Promise<void> | null = null;
  #disposed = false;
  readonly #checkListeners = new Set<() => Promise<void>>();
  #checkTimer: ReturnType<typeof setInterval> | null = null;
  #checkInFlight: Promise<void> | null = null;

  constructor(options: NodeProviderConfigRuntimeOptions) {
    this.#shucodeBuiltinSource = options.shucodeBuiltinEnvironment
      ? new EndpointScopedShucodeBuiltinSource({
          bundledFilePath: options.shucodeBuiltinFilePath,
          ...options.shucodeBuiltinEnvironment,
        })
      : new NodeShucodeBuiltinProviderConfigSource({
          bundledFilePath: options.shucodeBuiltinFilePath,
          activeFilePath: options.shucodeBuiltinActiveFilePath,
          watch: options.watch,
        });
    this.#remoteSynchronizer =
      options.shucodeBuiltinRemote &&
      this.#shucodeBuiltinSource instanceof NodeShucodeBuiltinProviderConfigSource
        ? new ShucodeBuiltinRemoteSynchronizer({
            source: this.#shucodeBuiltinSource,
            ...options.shucodeBuiltinRemote,
          })
        : undefined;
    this.#onRemoteRefreshError = options.onShucodeBuiltinRefreshError;
    this.#personalRepository = new NodePersonalProviderConfigRepository({
      filePath: options.personalFilePath,
      onRecovery: options.onPersonalConfigRecovery,
      onPollingError: options.onPersonalConfigPollingError,
      pollingIntervalMs: options.personalPollingIntervalMs,
      ...(options.importLegacy
        ? {
            importLegacy: async () =>
              options.importLegacy!(await this.#shucodeBuiltinSource.read()),
          }
        : {}),
    });
    this.configService = new ProviderConfigService({
      shucodeBuiltinSource: this.#shucodeBuiltinSource,
      personalRepository: this.#personalRepository,
    });
  }

  resolveShucodeBuiltinActiveFilePath(): Promise<string> {
    return this.#shucodeBuiltinSource instanceof NodeShucodeBuiltinProviderConfigSource
      ? Promise.resolve(this.#shucodeBuiltinSource.activeFilePath)
      : this.#shucodeBuiltinSource.resolveActiveFilePath();
  }

  get personalRepository(): import("@shucode/provider").PersonalProviderConfigRepository {
    return this.#personalRepository;
  }

  /** Environment 同一周期检查中恢复未对齐依赖，不被下载 TTL 或失败挡住。 */
  onDidCheckShucodeBuiltin(listener: () => Promise<void>): () => void {
    this.#checkListeners.add(listener);
    return () => this.#checkListeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.#disposed) throw new Error("NodeProviderConfigRuntime 已 dispose");
    if (this.#startPromise) return this.#startPromise;
    const startPromise = this.configService.read().then(() => {
      if (this.#disposed) return;
      void this.#checkBackground();
      // Managed Worker 无下载配置也无恢复 owner，不建立周期任务。
      if (
        this.#remoteSynchronizer ||
        this.#shucodeBuiltinSource instanceof EndpointScopedShucodeBuiltinSource ||
        this.#checkListeners.size > 0
      ) {
        this.#checkTimer = setInterval(() => {
          void this.#checkBackground();
        }, 60_000);
        this.#checkTimer.unref?.();
      }
    });
    this.#startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.#startPromise === startPromise) this.#startPromise = null;
    });
    return startPromise;
  }

  refreshShucodeBuiltin(options?: {
    readonly force?: boolean;
  }): Promise<ShucodeBuiltinRefreshResult> {
    if (this.#disposed) return Promise.resolve("disposed");
    if (this.#shucodeBuiltinSource instanceof EndpointScopedShucodeBuiltinSource) {
      return this.#shucodeBuiltinSource.refresh(options);
    }
    return this.#remoteSynchronizer?.refresh(options) ?? Promise.resolve("skipped");
  }

  #checkBackground(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#checkInFlight) return this.#checkInFlight;
    const check = Promise.allSettled([
      this.refreshShucodeBuiltin(),
      ...[...this.#checkListeners].map((listener) => Promise.resolve().then(listener)),
    ])
      .then((results) => {
        if (this.#disposed) return;
        for (const result of results)
          if (result.status === "rejected") this.#onRemoteRefreshError?.(result.reason);
      })
      .finally(() => {
        if (this.#checkInFlight === check) this.#checkInFlight = null;
      });
    this.#checkInFlight = check;
    return check;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#checkTimer) clearInterval(this.#checkTimer);
    this.#checkTimer = null;
    this.#checkListeners.clear();
    this.#remoteSynchronizer?.dispose();
    this.configService.dispose();
    this.#personalRepository.dispose();
    this.#shucodeBuiltinSource.dispose();
  }
}

export function createNodeProviderConfigRuntime(
  options: NodeProviderConfigRuntimeOptions,
): NodeProviderConfigRuntime {
  return new NodeProviderConfigRuntime(options);
}
