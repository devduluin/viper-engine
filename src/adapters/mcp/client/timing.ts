import type { Clock } from '../../../contracts/identity/ports.js';
import type { McpCallOptions } from '../../../contracts/mcp/gateway.js';
import { assertTimerDuration } from '../../../shared/async/delay.js';
import { withDeadline } from '../../../shared/async/deadline.js';
import type { McpFailureCode } from '../../../contracts/mcp/outcome.js';

export function timingFailure(options: McpCallOptions, now: number): McpFailureCode | undefined {
  if (options.signal?.aborted === true) return 'cancelled';
  if (!Number.isFinite(now)) return 'invalid_value';
  if (options.deadlineAt === undefined) return undefined;
  if (!Number.isFinite(options.deadlineAt)) return 'invalid_value';
  return options.deadlineAt <= now ? 'timeout' : undefined;
}

/** Whole-operation limit, including catalog pagination and advertised-resource checks. */
export function timedMcp<Value>(clock: Clock, timeoutMs: number, options: McpCallOptions,
  work: (bounded: McpCallOptions) => Promise<Value>): Promise<Value> {
  assertTimerDuration('MCP request timeout', timeoutMs);
  const now = clock.now();
  if (!Number.isFinite(now)) throw new Error('Invalid MCP clock');
  const remaining = options.deadlineAt === undefined ? timeoutMs : options.deadlineAt - now;
  if (!Number.isFinite(remaining)) throw new Error('Invalid MCP deadline');
  return withDeadline(signal => work({ ...options, signal }), {
    operationName: 'MCP operation', timeoutMs: Math.max(0, Math.min(timeoutMs, remaining)),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}
