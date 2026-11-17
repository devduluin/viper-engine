/** How long a human approval proposal stays decidable. One default for in-process and durable runs. */
export const DEFAULT_APPROVAL_TTL_MS = 60_000;

/** Positive safe-integer milliseconds; `undefined` means the default. */
export function parseApprovalTtl(value: number | undefined = DEFAULT_APPROVAL_TTL_MS): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid approval TTL');
  return value;
}
