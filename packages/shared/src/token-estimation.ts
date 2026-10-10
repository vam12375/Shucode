/**
 * Shared fallback divisor for character-based token estimates.
 *
 * Provider usage remains the source of truth when available. CLI callers use
 * this value only for local context, compaction, and reminder estimates.
 */
export const ESTIMATED_TOKEN_CHAR_DIVISOR = 3;
