export function inputSideTokensFromNormalizedUsage(
  inputTokens: number | null | undefined,
  cacheCreationTokens: number | null | undefined,
  cacheReadTokens: number | null | undefined,
): number {
  const input = integer(inputTokens);
  if (input > 0) {
    return input;
  }
  return integer(cacheCreationTokens) + integer(cacheReadTokens);
}

export function integer(value: number | null | undefined): number {
  // providerTotalTokens 这类旧记录字段可能是 null；adapters 独立 tsc 需要先完成类型收窄。
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

export function boolean(value: boolean | undefined): number {
  return value ? 1 : 0;
}

export function nullableBoolean(value: boolean | undefined): number | null {
  return value === undefined ? null : boolean(value);
}
