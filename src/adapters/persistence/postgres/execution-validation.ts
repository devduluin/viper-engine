import type { ModelCallFinish } from '../../../contracts/state/execution-records.js';
import { parseModelUsage } from '../../../contracts/models/usage.js';

const FAILURE_CODES: ReadonlySet<string> = new Set([
  'authentication_required', 'permission', 'rate_limited', 'timeout', 'transport', 'invalid_response',
  'unsupported', 'cancelled', 'output_limit', 'unknown',
]);

/** Reject raw provider text and invalid usage at the storage boundary, even for typed callers. */
export function validateModelFinish(input: ModelCallFinish): void {
  parseModelUsage(input.usage);
  if (input.outcome === 'failed') {
    if (input.failureCode === undefined || !FAILURE_CODES.has(input.failureCode)) throw new Error('Invalid model failure code');
  } else if (input.failureCode !== undefined) throw new Error('Only a failed model call has a failure code');
}
