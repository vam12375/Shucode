# CLI Token Estimation Contract

## Rule

The CLI's fallback token estimates use one shared character divisor. The current divisor is `3`; Chinese characters are weighted by the existing caller before division. This estimate is only for context display, compaction thresholds, and post-compaction reminders. It is not provider-reported usage and must not be used as a billing value.

## Ownership and interface

`packages/shared/src/token-estimation.ts` owns the exported `ESTIMATED_TOKEN_CHAR_DIVISOR` constant. CLI core consumers import it through the public `@shucode/shared` entrypoint. No consumer may duplicate the literal or create a second divisor for the same estimate family.

## Compatibility

Restoring this export preserves the estimator behavior that existed before the shared subscription cleanup. It does not restore removed subscription, quota, or usage APIs. A future change to the divisor must update this contract and validate context estimation, manual compaction, and post-compaction reminder thresholds together.

## Acceptance

- `pnpm --dir apps/shucode-cli --filter @shucode/core build` succeeds.
- `estimateTokens`, `estimateMessageTokens`, and post-compaction read reminders compile against the same shared divisor.
- The shared package exports the constant from its public barrel.
