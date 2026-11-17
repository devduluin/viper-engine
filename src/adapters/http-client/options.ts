import { EngineClientFailure } from '../../contracts/client/failure.js';
import { assertTimerDuration } from '../../shared/async/delay.js';

export interface EngineClientOptions {
  readonly baseUrl: string; readonly getToken: () => Promise<string>;
  readonly fetch?: typeof globalThis.fetch;
  readonly requestTimeoutMs?: number; readonly streamIdleMs?: number;
  readonly requestBytes?: number; readonly responseBytes?: number; readonly eventBytes?: number;
}
function positive(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new EngineClientFailure('INVALID_REQUEST');
  return value;
}
function origin(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new EngineClientFailure('INVALID_REQUEST'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname !== '/') throw new EngineClientFailure('INVALID_REQUEST');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new EngineClientFailure('INVALID_REQUEST');
  return url.origin;
}
function timers(options: EngineClientOptions) {
  const requestTimeoutMs = positive(options.requestTimeoutMs ?? 15000, 2147483647);
  const streamIdleMs = positive(options.streamIdleMs ?? 45000, 2147483647);
  assertTimerDuration('client timeout', requestTimeoutMs); assertTimerDuration('stream idle', streamIdleMs);
  return { requestTimeoutMs, streamIdleMs };
}
export function clientSettings(options: EngineClientOptions) {
  return Object.freeze({ origin: origin(options.baseUrl), getToken: options.getToken, fetch: options.fetch ?? globalThis.fetch,
    ...timers(options), requestBytes: positive(options.requestBytes ?? 1048576, 1048576),
    responseBytes: positive(options.responseBytes ?? 4194304, 33554432), eventBytes: positive(options.eventBytes ?? 1048576, 1048576) });
}
export type ClientSettings = ReturnType<typeof clientSettings>;
