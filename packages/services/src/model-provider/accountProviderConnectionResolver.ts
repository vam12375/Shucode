import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  AccountProviderUnavailableReason,
  AccountProviderConnectionResolver,
  AccountProviderConnectionResult,
  ProviderConfigSnapshot,
  ProviderSource,
} from "@shucode/provider";
import { AccountProviderService, createAccountProviderConfigResolver } from "@shucode/provider";
import {
  type ProviderFamilyConnectionSelectionSettings,
  type ProviderFamilyDomain,
  type ShucodeAccountAccess,
  type ShucodeProviderAccountAccess,
} from "@shucode/shared";

export interface AccountProviderConnectionSettings {
  readonly providerFamilyDomain: ProviderFamilyDomain | null;
  readonly selections: ProviderFamilyConnectionSelectionSettings;
  /** Host 旧连接导入尚不能确定身份；仅运行时事实，不写入配置或协议。 */
  readonly unresolvedFamilies?: readonly ProviderFamilyDomain[];
}

export interface AccountProviderConnectionResolverOptions {
  readonly readSettings: () => Promise<AccountProviderConnectionSettings>;
  readonly loadCodingPlanApiKey: (
    providerId: string,
    family: ProviderFamilyDomain,
    accountIdentity: string,
    forceRefresh: boolean,
  ) => Promise<string | null>;
  readonly loadAccountIdentity: (family: ProviderFamilyDomain) => Promise<string | null>;
}

export interface AccountProviderConfigSourceOptions extends AccountProviderConnectionResolverOptions {
  readonly configSource: ProviderSource<ProviderConfigSnapshot>;
}

/**
 * 把现有账号域与连接模式投影为领域层 Connection Result。
 *
 * 二开定制说明：原实现会调用 `validateZaiAccountProviderAvailability` /
 * `validateBigModelAccountProviderAvailability`（经 `createCodingPlanFamilyAvailabilityResolver`
 * 注入）去远端查询套餐订阅，并据此决定 connected / unavailable 与 reason。
 * 套餐与权益链路已整体删除，这里改为**只按凭据是否存在判定连接状态**：
 *   - 拿不到当前账号身份（OAuth 登录态）→ `unavailable` + `not-connected`；
 *   - 有身份但该连接模式的凭据缺失（individual 需 Coding Plan Key）→ `unavailable` + `credential-failed`；
 *   - 有身份且有凭据 → `available`；
 *   - `off-peak` / `start-plan` / `team-coding-plan` 没有独立的可读凭据（key 在请求期投影），
 *     因此只要有登录身份即 `available`，具体准入仍由服务端裁决。
 * 保留对外形状（`createAccountProviderConfigSource` / `createAccountProviderConnectionResolver`
 * / `resolveCurrentAccountAccess`）与"未配置任何 account provider 时返回空集合"的行为不变，
 * 以免影响保留的账号凭据运行时（模型请求鉴权、闲时任务、动态工作流、官方 MCP 凭据）。
 *
 * 该适配器不保存凭据。Personal Coding Plan Key 的物理来源由注入端决定；
 * Start/Team 的动态凭据继续由现有依赖按请求读取。
 */
export function createAccountProviderConnectionResolver(
  options: AccountProviderConnectionResolverOptions,
): AccountProviderConnectionResolver {
  let previousScopes = new Map<string, string>();
  return async ({ configuredProviders, reasons = [] }) => {
    const settings = structuredClone(await options.readSettings());
    const forceCredentialRefresh = reasons.some(isCredentialRefreshReason);
    const accountIdentityByFamily = new Map<ProviderFamilyDomain, Promise<string | null>>();
    const loadAccountIdentity = (family: ProviderFamilyDomain) => {
      const existing = accountIdentityByFamily.get(family);
      if (existing) return existing;
      const pending = options.loadAccountIdentity(family).then((identity) => {
        const normalized = identity?.trim() ?? "";
        return normalized || null;
      });
      accountIdentityByFamily.set(family, pending);
      return pending;
    };

    // 凭据事实按 providerId 缓存：同一轮内多个查询点不能重复打凭据存储。
    const credentialAvailableByProviderId = new Map<
      string,
      Promise<{ accountIdentity: string | null; hasCredential: boolean }>
    >();
    const resolveCredentialFact = (params: {
      providerId: string;
      family: ProviderFamilyDomain;
      planKind: "start-plan" | "individual-coding-plan" | "team-coding-plan" | "off-peak";
    }) => {
      const existing = credentialAvailableByProviderId.get(params.providerId);
      if (existing) return existing;
      const pending = (async () => {
        const accountIdentity = await loadAccountIdentity(params.family);
        if (!accountIdentity) {
          return { accountIdentity: null, hasCredential: false };
        }
        // Start Plan / Team Plan / Off-Peak 都不读 Coding Plan Key：Start 与 Off-Peak 跟随登录身份，
        // Team 由 accountProviderTeamPlanRequestKey 在请求期投影运行时 key。
        if (params.planKind !== "individual-coding-plan") {
          return { accountIdentity, hasCredential: true };
        }
        const apiKey = await options
          .loadCodingPlanApiKey(
            params.providerId,
            params.family,
            accountIdentity,
            forceCredentialRefresh,
          )
          .catch(() => null);
        return { accountIdentity, hasCredential: Boolean(apiKey?.trim()) };
      })();
      credentialAvailableByProviderId.set(params.providerId, pending);
      return pending;
    };

    const connections: AccountProviderConnectionResult[] = [];
    const scopes = new Map<string, string>();
    for (const [providerId, config] of configuredProviders.entries()) {
      const access = config.access;
      if (access?.type !== "zhipu-account") continue;
      if (!access.accountType || !access.mode) {
        connections.push({ providerId, status: "unavailable" });
        continue;
      }
      // 属性收窄不会跨 await 保留；先落成局部常量再参与后续判定。
      const accountType: ProviderFamilyDomain = access.accountType;
      const mode = access.mode;
      const selection = settings.selections[accountType];
      // last-known-good 只对同账号、同 Team 身份成立。切账号后的凭据缺失不能复活旧连接。
      const scope = JSON.stringify([
        await loadAccountIdentity(accountType),
        mode === "team-coding-plan" && selection?.kind === "team-coding-plan"
          ? [selection.organizationId, selection.projectId, selection.productId]
          : null,
      ]);
      scopes.set(providerId, scope);
      const resetPrevious =
        previousScopes.has(providerId) && previousScopes.get(providerId) !== scope;
      // Start 跟随登录身份，付费连接跟随连接选择；两者可同时 current，不改写配置。
      const current =
        settings.providerFamilyDomain === accountType &&
        (mode === "start-plan"
          ? Boolean(await loadAccountIdentity(accountType))
          : selection?.kind === mode);
      const connectionKey = createHash("sha256")
        .update(
          JSON.stringify([
            await loadAccountIdentity(accountType),
            accountType,
            mode === "start-plan" ? { kind: "start-plan" } : (selection ?? null),
          ]),
        )
        .digest("hex");
      const base = {
        current,
        // 两个 Team 共用 Provider ID，观察器必须按同一快照中的完整身份比较，
        // 不能把手动换账号误当成原连接失效。它只进入 Account State，不进入 Config。
        connectionKey,
        ...(resetPrevious ? { resetPrevious: true } : {}),
      };

      // 旧团队身份补全尚不能确定身份时保持 unknown，不凭缺失的凭据把它判成未连接。
      if (settings.unresolvedFamilies?.includes(accountType) && mode !== "start-plan") {
        connections.push({ providerId, status: "unknown", ...base });
        continue;
      }

      if (mode === "off-peak") {
        // Off-Peak 没有自己的凭据（不读 Coding Plan Key、也不投影 Team 运行时 key），
        // 它只要求当前账号域仍有可用的登录身份。二开删除了套餐购买链路，
        // 因此不能再像旧实现那样"跟随所选付费套餐是否可用"——否则删掉付费节点后
        // 闲时任务会被永久判成未连接。准入/低峰仍由服务端裁决（3006 兜底）。
        const fact = await resolveCredentialFact({
          providerId,
          family: accountType,
          planKind: mode,
        });
        connections.push({
          providerId,
          status: fact.hasCredential ? "available" : "unavailable",
          ...(fact.hasCredential
            ? {}
            : { unavailableReason: resolveAccountUnavailableReason("not_connected") }),
          ...base,
        });
        continue;
      }

      const fact = await resolveCredentialFact({
        providerId,
        family: accountType,
        planKind: mode,
      });
      if (fact.hasCredential) {
        connections.push({ providerId, status: "available", ...base });
        continue;
      }
      connections.push({
        providerId,
        status: "unavailable",
        // 原因必须随连接结果一起发布。UI 拿不到原因时只能把"未登录"与"凭据失效"混为一谈。
        unavailableReason: resolveAccountUnavailableReason(
          fact.accountIdentity ? "credential_failed" : "not_connected",
        ),
        ...base,
      });
    }

    // 凭据查询可能跨越切账号/套餐，旧设置与新身份会被拼成可发布结果。
    // 发布前核对本轮作用域；失败时也不能推进 previousScopes，否则下一轮会把
    // 未发布的账号误认作 last-known-good。重试继续由现有刷新事件驱动。
    const identitiesUnchanged = await Promise.all(
      [...accountIdentityByFamily].map(
        async ([family, captured]) =>
          (await captured) === ((await options.loadAccountIdentity(family))?.trim() || null),
      ),
    );
    if (
      identitiesUnchanged.some((unchanged) => !unchanged) ||
      !isDeepStrictEqual(settings, await options.readSettings())
    ) {
      throw new Error("账号查询期间连接或身份发生变化，丢弃过期结果");
    }
    previousScopes = scopes;
    return Object.freeze(connections);
  };
}

function isCredentialRefreshReason(reason: string): boolean {
  // ProviderSettingsFacade 会给登录刷新原因添加 settings: 前缀；漏匹配会在
  // 同账号重新登录后继续复用失效 Key。按原因末段精确匹配，普通刷新仍复用缓存。
  return (
    reason.includes("oauth-callback") || reason.split(":").at(-1) === "oauth-login-entitlement"
  );
}

/**
 * 把连接事实原因投影为账号域原因。
 * Account State 是跨 family 的通用事实；UI 只依赖这里的稳定语义，不认识凭据实现。
 */
function resolveAccountUnavailableReason(
  reason: "not_connected" | "credential_failed",
): AccountProviderUnavailableReason {
  return reason === "credential_failed" ? "credential-failed" : "not-connected";
}

/** 组装 Config、账号连接解析与第三层 Account Provider Config Source。 */
export function createAccountProviderConfigSource(
  options: AccountProviderConfigSourceOptions,
): AccountProviderService {
  return new AccountProviderService({
    configSource: options.configSource,
    resolve: createAccountProviderConfigResolver(createAccountProviderConnectionResolver(options)),
  });
}

/**
 * 把 Active Model 的静态 Access 约束投影到当前账号连接。
 *
 * Team scope 和账号版本不能冻结进 Model：账号切换后旧 Model 会错误失效。
 * 每次请求重新读取当前选择；只有 family 与 mode 兼容时才返回动态访问事实。
 */
export async function resolveCurrentAccountAccess(input: {
  readonly access: ShucodeProviderAccountAccess;
  readonly readSettings: () => Promise<AccountProviderConnectionSettings>;
  readonly loadAccountIdentity: (family: ProviderFamilyDomain) => Promise<string | null>;
}): Promise<ShucodeAccountAccess | null> {
  const settings = await input.readSettings();
  const { accountType, mode } = input.access;
  if (settings.providerFamilyDomain !== accountType) return null;
  if (mode === "start-plan") {
    if (!(await input.loadAccountIdentity(accountType))?.trim()) return null;
    return { type: "zhipu-account", family: accountType, planKind: "start-plan" };
  }
  const selection = settings.selections[accountType];
  if (!selection) return null;
  if (mode === "off-peak") {
    if (selection.kind !== "individual-coding-plan" && selection.kind !== "team-coding-plan") {
      return null;
    }
  } else if (selection.kind !== mode) {
    return null;
  }
  if (!(await input.loadAccountIdentity(accountType))?.trim()) return null;
  if (selection.kind === "team-coding-plan") {
    return {
      type: "zhipu-account",
      family: accountType,
      planKind: selection.kind,
      productId: selection.productId,
      organizationId: selection.organizationId,
      projectId: selection.projectId,
    };
  }
  return {
    type: "zhipu-account",
    family: accountType,
    planKind: selection.kind,
  };
}
