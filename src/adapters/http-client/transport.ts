import type { ClientSettings } from './options.js';
import { ClientCodec } from './codec.js';
import type { Responses } from './codec.js';
import { EngineClientFailure } from '../../contracts/client/failure.js';
import { readJsonBody, utf8Bytes } from './body.js';
import { withDeadline } from '../../shared/async/deadline.js';
import { DeadlineExceededError } from '../../shared/async/errors.js';
import type { ClientRead } from '../../contracts/client/ports.js';

export class ClientTransport {
  requestBytes: number; eventBytes: number;
  constructor(readonly config: ClientSettings, readonly codec: ClientCodec) { this.requestBytes = config.requestBytes; this.eventBytes = config.eventBytes; }

  async headers(): Promise<Record<string, string>> {
    const token = await this.config.getToken();
    if (!/^[^\s,]{1,8192}$/.test(token)) throw new EngineClientFailure('AUTHENTICATION_REQUIRED');
    return { authorization: `Bearer ${token}` };
  }

  async error(response: Response, signal: AbortSignal): Promise<never> {
    try {
      const parsed = this.codec.response('ErrorResponse', await readJsonBody(response, this.config.responseBytes, signal)).error;
      throw new EngineClientFailure(parsed.code, { status: response.status, requestId: parsed.requestId,
        ...(parsed.recovery === undefined ? {} : { recovery: parsed.recovery }) });
    } catch (error) {
      if (error instanceof EngineClientFailure && error.code !== 'INVALID_RESPONSE') throw error;
      throw new EngineClientFailure('HTTP_ERROR', { status: response.status });
    }
  }

  async request<K extends keyof Responses>(path: string, schema: K, status: number, body?: string,
    options: ClientRead = {}, headers: Record<string, string> = {}): Promise<Responses[K]> {
    if (body !== undefined && utf8Bytes(body) > this.requestBytes) throw new EngineClientFailure('PAYLOAD_TOO_LARGE');
    try {
      return await withDeadline(async signal => {
        const response = await this.config.fetch(`${this.config.origin}${path}`, { method: body === undefined ? 'GET' : 'POST',
          redirect: 'error', credentials: 'omit', signal, headers: { ...await this.headers(), accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body }) });
        if (!response.ok) return this.error(response, signal);
        if (response.status !== status || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
          await response.body?.cancel(); throw new EngineClientFailure('INVALID_RESPONSE');
        }
        return this.codec.response(schema, await readJsonBody(response, this.config.responseBytes, signal));
      }, { operationName: 'Viper HTTP request', timeoutMs: this.config.requestTimeoutMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }) });
    } catch (error) { throw transportFailure(error, options.signal); }
  }
}

export function transportFailure(error: unknown, signal?: AbortSignal): EngineClientFailure {
  if (signal?.aborted) return new EngineClientFailure('CANCELLED');
  if (error instanceof EngineClientFailure) return error;
  if (error instanceof DeadlineExceededError) return new EngineClientFailure('TIMEOUT');
  return new EngineClientFailure('NETWORK_ERROR');
}
