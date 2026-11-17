import { EngineClientFailure } from '../../contracts/client/failure.js';
import type { WatchOptions } from '../../contracts/client/ports.js';
import { delay, assertTimerDuration } from '../../shared/async/delay.js';

export function watchSettings(options: WatchOptions) {
  const retries = options.maxReconnects ?? 8;
  const base = options.reconnectMs ?? 250; const maximum = options.maxReconnectMs ?? 5000;
  assertTimerDuration('reconnect', base); assertTimerDuration('maximum reconnect', maximum);
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 100 || base < 1 || maximum < base) {
    throw new EngineClientFailure('INVALID_REQUEST');
  }
  return { retries, base, maximum };
}
export function recoverable(error: unknown): 'snapshot' | 'reconnect' | undefined {
  if (!(error instanceof EngineClientFailure)) return undefined;
  if (['EVENT_CURSOR_EXPIRED', 'INVALID_CURSOR', 'STREAM_GAP', 'UNSUPPORTED_EVENT'].includes(error.code)) return 'snapshot';
  if (['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'CONNECTION_UNAVAILABLE', 'STREAM_CLOSED'].includes(error.code)) return 'reconnect';
  if (error.status !== undefined && error.status >= 500) return 'reconnect';
  return undefined;
}
export async function reconnectDelay(attempt: number, settings: ReturnType<typeof watchSettings>, signal?: AbortSignal): Promise<void> {
  try { await delay(Math.min(settings.maximum, settings.base * 2 ** Math.min(attempt, 20)), signal === undefined ? {} : { signal }); }
  catch { throw new EngineClientFailure('CANCELLED'); }
}
export function terminal(status: string): boolean { return ['completed', 'partial', 'failed', 'cancelled'].includes(status); }
export function terminalEvent(type: string): boolean { return ['run.completed', 'run.partial', 'run.failed', 'run.cancelled'].includes(type); }
