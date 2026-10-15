/**
 * PlatformUserConfigService —— 平台用户级配置的拉取与应用。
 *
 * 与 providerProvisioningTarget 的关系：本服务只负责「取回信封 + 归一化」，
 * 应用仍走同一个 Provisioning 目标（syncId 幂等 / CAS / 回滚），
 * 不在本地配置上开第二条写入路径。
 *
 * endpoint 401/403 表示凭据被吊销或成员被移除：清除本机平台凭据，
 * 登录态失效（欢迎页回到登录入口），下次 refresh 以 no-credential 跳过。
 */
import {
  PLATFORM_USER_CONFIG_API_PATH,
  providerProvisioningEnvelopeSchema,
  type ApiClient,
  type AppSettings,
  type ModelSelection,
  type ProviderProvisioningEnvelope,
  type ProviderProvisioningResult,
} from "@shucode/shared";
import type { ICredentialService } from "../credential/credential.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type {
  IPlatformUserConfigService,
  PlatformUserConfigSyncResult,
  PlatformUserConfigSyncStatus,
} from "./platformUserConfig.js";
import { clearPlatformCredentials, readPlatformCredentialBundle } from "./platformCredentials.js";

const HOUR_MS = 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 15_000;

interface PlatformAccountSettingsSnapshot {
  providerFamilyDomain?: AppSettings["providerFamilyDomain"];
  providerFamilyConnectionSelections?: AppSettings["providerFamilyConnectionSelections"];
}

interface PlatformUserConfigServiceDependencies {
  apiClient: ApiClient;
  resolveEndpointOrigin: () => string | Promise<string>;
  /** 应用信封的唯一边界：合并进 personal 层（见 platformUserConfigApply，本地供应商保留）。 */
  applyEnvelope: (envelope: ProviderProvisioningEnvelope) => Promise<ProviderProvisioningResult>;
  /** 读取本地当前 account settings，用于归一化信封中的空值（这些字段所有权不在云端）。 */
  getCurrentAccountSettings: () => Promise<PlatformAccountSettingsSnapshot>;
  now?: () => number;
  intervalMs?: number;
  /**
   * 用 Registry 事实给云端偏好默认补齐档位（reasoningLevel）。
   * 档位值域来自内置模型规则，是客户端域知识；Registre 完整校验要求默认选择必须带合法档位，
   * 云端信封因此只下发"偏好"，由客户端在应用后补全。
   */
  resolveCompletedDefaultSelection?: (selection: ModelSelection) => ModelSelection | undefined;
  /** 写入本机配置的默认模型选择（modelSelectionConfigRepository.saveConfiguredDefault）。 */
  saveConfiguredDefault?: (selection: ModelSelection | undefined) => Promise<void>;
  /** 登录成功后的即时同步入口由调用方触发 refresh()，不需要额外订阅。 */
}

export class PlatformUserConfigService implements IPlatformUserConfigService {
  readonly #credentialService: ICredentialService;
  readonly #apiClient: ApiClient;
  readonly #resolveEndpointOrigin: () => string | Promise<string>;
  readonly #applyEnvelope: PlatformUserConfigServiceDependencies["applyEnvelope"];
  readonly #getCurrentAccountSettings: PlatformUserConfigServiceDependencies["getCurrentAccountSettings"];
  readonly #resolveCompletedDefaultSelection?: PlatformUserConfigServiceDependencies["resolveCompletedDefaultSelection"];
  readonly #saveConfiguredDefault?: PlatformUserConfigServiceDependencies["saveConfiguredDefault"];
  readonly #now: () => number;
  readonly #intervalMs: number;
  readonly #log = createServiceLogger("platformUserConfig");
  #timer: NodeJS.Timeout | null = null;
  #disposed = false;
  #refreshing = false;
  #lastApply: ProviderProvisioningResult | null = null;
  #status: PlatformUserConfigSyncStatus = { lastSyncAt: null, lastResult: null, lastApply: null };

  constructor(
    credentialService: ICredentialService,
    dependencies: PlatformUserConfigServiceDependencies,
  ) {
    this.#credentialService = credentialService;
    this.#apiClient = dependencies.apiClient;
    this.#resolveEndpointOrigin = dependencies.resolveEndpointOrigin;
    this.#applyEnvelope = dependencies.applyEnvelope;
    this.#getCurrentAccountSettings = dependencies.getCurrentAccountSettings;
    this.#resolveCompletedDefaultSelection = dependencies.resolveCompletedDefaultSelection;
    this.#saveConfiguredDefault = dependencies.saveConfiguredDefault;
    this.#now = dependencies.now ?? Date.now;
    this.#intervalMs = dependencies.intervalMs ?? HOUR_MS;
  }

  getStatus(): PlatformUserConfigSyncStatus {
    return { ...this.#status };
  }

  start(): void {
    if (this.#disposed || this.#timer) return;
    // 启动即一次（无凭据时自然跳过），随后按周期刷新。
    void this.refresh();
    this.#scheduleNext();
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async refresh(): Promise<PlatformUserConfigSyncResult> {
    if (this.#refreshing) {
      return { kind: "skipped", reason: "in-flight" };
    }
    this.#refreshing = true;
    try {
      const result = await this.#refreshInternal();
      this.#status = {
        lastSyncAt: new Date(this.#now()).toISOString(),
        lastResult: result,
        lastApply: this.#lastApply,
      };
      return result;
    } finally {
      this.#refreshing = false;
    }
  }

  async #refreshInternal(): Promise<PlatformUserConfigSyncResult> {
    const origin = await this.#resolveEndpointOrigin();
    const bundle = await readPlatformCredentialBundle(this.#credentialService, origin);
    if (!bundle) {
      return { kind: "skipped", reason: "no-credential" };
    }

    const url = new URL(PLATFORM_USER_CONFIG_API_PATH, origin);
    let response: Response;
    try {
      response = await this.#apiClient.request(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${bundle.deviceToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.#log.warn("平台用户配置拉取失败（网络）", { error });
      return { kind: "failed", message: "network" };
    }

    if (response.status === 401 || response.status === 403) {
      // 凭据被吊销 / 成员被移出团队：平台登录态已失效，清理本机凭据并等待重新登录。
      await clearPlatformCredentials(this.#credentialService);
      this.#log.info("平台凭据已失效并被清除", { status: response.status });
      return { kind: "failed", message: "unauthorized", unauthorized: true };
    }
    if (!response.ok) {
      this.#log.warn("平台用户配置拉取失败（HTTP）", { status: response.status });
      return { kind: "failed", message: `http_${response.status}` };
    }

    let envelope: ProviderProvisioningEnvelope;
    try {
      const payload = (await response.json()) as { code?: unknown; data?: unknown };
      if (payload.code !== 0) {
        return { kind: "failed", message: "server_code" };
      }
      const rawEnvelope = (payload.data as { envelope?: unknown } | null)?.envelope;
      envelope = providerProvisioningEnvelopeSchema.parse(rawEnvelope);
    } catch (error) {
      this.#log.warn("平台用户配置响应无法解析", { error });
      return { kind: "failed", message: "invalid_response" };
    }

    // 云端默认选择只是"偏好"：Registry 完整校验要求档位（reasoningLevel 值域来自内置模型规则，
    // 是客户端域知识），因此这里先把它从应用信封中剥离，应用成功后再用 Registry 事实补档位写回；
    // 不剥离会让校验失败并触发整个信封回滚。
    const preferredDefault = envelope.personalConfig.defaultModelSelection;
    const { defaultModelSelection: _preferredDefault, ...personalConfigWithoutDefault } =
      envelope.personalConfig;
    const stabilized = await this.#stabilizeAccountSettings(
      providerProvisioningEnvelopeSchema.parse({
        ...envelope,
        personalConfig: personalConfigWithoutDefault,
      }),
    );
    let applyResult: ProviderProvisioningResult;
    try {
      applyResult = await this.#applyEnvelope(stabilized);
    } catch (error) {
      this.#log.warn("平台用户配置应用失败", { error });
      return {
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    this.#lastApply = applyResult;

    if (applyResult.status === "applied") {
      this.#log.info("平台用户配置已应用", {
        personalProviderCount: applyResult.personalProviderCount,
        configRevision: applyResult.configRevision,
      });
      await this.#applyPreferredDefault(preferredDefault);
      return { kind: "applied" };
    }
    if (applyResult.status === "already-applied") {
      this.#log.debug("平台用户配置无变化（already-applied）", {
        syncId: applyResult.syncId,
      });
      return { kind: "already-applied" };
    }
    this.#log.warn("平台用户配置应用未成功", {
      status: applyResult.status,
      errorMessage: applyResult.errorMessage,
    });
    return {
      kind: "failed",
      message: applyResult.errorMessage ?? applyResult.status,
    };
  }

  /**
   * 补全并写入云端偏好默认（只在本次真正应用了新配置后执行）。
   * 失败只告警不改变应用结果：默认模型是可丢弃偏好，用户可以手动重选；
   * 若这里把 failed 传播出去，会让一次成功的配置应用看起来整体失败。
   */
  async #applyPreferredDefault(preferred: ModelSelection | undefined): Promise<void> {
    if (!preferred) return;
    const resolve = this.#resolveCompletedDefaultSelection;
    const save = this.#saveConfiguredDefault;
    if (!resolve || !save) {
      this.#log.warn("缺少默认模型补齐能力，跳过写入云端偏好默认", {
        providerId: preferred.providerId,
        modelId: preferred.modelId,
      });
      return;
    }
    try {
      const completed = resolve(preferred);
      if (!completed) {
        this.#log.warn("云端偏好默认无法在 Registry 中补全档位，跳过写入", {
          providerId: preferred.providerId,
          modelId: preferred.modelId,
        });
        return;
      }
      await save(completed);
      this.#log.info("云端偏好默认已补全档位并写入", {
        providerId: completed.providerId,
        modelId: completed.modelId,
        reasoningLevel: completed.options?.reasoningLevel,
      });
    } catch (error) {
      this.#log.warn("写入云端偏好默认失败", { error });
    }
  }

  /**
   * 云端信封的 accountSettings 空值不覆写本地：
   * providerFamilyDomain 为 null / selections 为空对象时沿用本机当前值，
   * 非空值才生效（这些字段的所有权仍在本地账号链路，云端不下发）。
   */
  async #stabilizeAccountSettings(
    envelope: ProviderProvisioningEnvelope,
  ): Promise<ProviderProvisioningEnvelope> {
    const incoming = envelope.accountSettings;
    const hasSelections =
      incoming.providerFamilyConnectionSelections !== undefined &&
      Object.keys(incoming.providerFamilyConnectionSelections).length > 0;
    if (incoming.providerFamilyDomain !== null && hasSelections) {
      return envelope;
    }
    const current = await this.#getCurrentAccountSettings();
    return providerProvisioningEnvelopeSchema.parse({
      ...envelope,
      accountSettings: {
        providerFamilyDomain: incoming.providerFamilyDomain ?? current.providerFamilyDomain ?? null,
        providerFamilyConnectionSelections: hasSelections
          ? incoming.providerFamilyConnectionSelections
          : (current.providerFamilyConnectionSelections ?? {}),
      },
    });
  }

  #scheduleNext(): void {
    if (this.#disposed) return;
    const timer = setTimeout(() => {
      this.#timer = null;
      void this.refresh().finally(() => {
        this.#scheduleNext();
      });
    }, this.#intervalMs);
    timer.unref?.();
    this.#timer = timer;
  }
}

export function createPlatformUserConfigService(
  credentialService: ICredentialService,
  dependencies: PlatformUserConfigServiceDependencies,
): PlatformUserConfigService {
  return new PlatformUserConfigService(credentialService, dependencies);
}
