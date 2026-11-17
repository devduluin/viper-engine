// Provenance: ai-intent-api-v2/src/utils/result-emptiness.util.ts
// SHA-256 2f5d750535565e5d35b71f28d2323a3d2d25ff68c1ac138ed9aa66aaf577597c (P02-03 copy).
// Behavior preserved; `readResultErrorField` intentionally not adopted (see P02-01 manifest).

/**
 * True for null, undefined, an empty/whitespace-only string, or an empty array.
 * Zero, false and empty objects are nonempty. This is a value predicate only:
 * an empty read result can still be a successful execution outcome.
 */
export function isEmptyPrimitiveValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
