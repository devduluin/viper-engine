import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedIdentity, TrustedScope } from '../../contracts/identity/scope.js';
import { scopeFromAuthenticatedIdentity } from '../../contracts/identity/scope.js';
import { sameScope } from '../../contracts/identity/scope.js';
import type { ApiHandler } from '../../contracts/api/control.js';
import { ApiFailure } from '../../contracts/api/failure.js';
import { API_ERROR_STATUS } from '../../contracts/api/errors.js';
import { HTTP_ROUTES } from './routes.js';
import { apiValidation } from './schema-validation.js';
import { apiCall, singleHeader } from './request.js';
import type { HttpReplay } from './sse/types.js';
import { StreamSessions } from './sse/sessions.js';
import { handleEventStream } from './sse/handler.js';
import { registerMemoryRoutes } from './memory.js';
import type { UserMemoryPort } from '../../contracts/recall/user-memory.js';

export interface HttpOptions {
  readonly userMemory?: UserMemoryPort;
  readonly authenticate: (bearerToken: string) => Promise<AuthenticatedIdentity | undefined>;
  readonly requestBytes: number;
  readonly replay?: HttpReplay;
  /**
   * Exact paths (no query) the host serves without a bearer token, e.g. health, login and first-run setup. Engine
   * routes never become public through this list: they still require an authenticated scope.
   */
  readonly publicRoutes?: readonly string[];
}

/** Constructs a server without listening. Host owns auth, DB and worker lifetimes. */
export function createHttpServer(handler: ApiHandler, options: HttpOptions) {
  const app = Fastify({ logger: false, bodyLimit: options.requestBytes, requestIdHeader: false,
    genReqId: () => randomUUID(), trustProxy: false, exposeHeadRoutes: false, routerOptions: { maxParamLength: 4096 } });
  const scopes = new WeakMap<FastifyRequest, TrustedScope>(); const validator = apiValidation(options.requestBytes);
  const streams = options.replay === undefined ? undefined : new StreamSessions(options.replay.options);
  app.addHook('preClose', async () => { streams?.close(); });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id).header('cache-control', 'no-store');
    if (options.publicRoutes?.includes(request.url.split('?')[0] ?? '')) return;
    scopes.set(request, await authenticateRequest(request, options));
  });
  app.setErrorHandler((error, request, reply) => {
    const failure = error instanceof ApiFailure ? error : frameworkFailure(error);
    if (!(error instanceof ApiFailure) && failure.code === 'INTERNAL_ERROR') logInternal(error, request.id, request.routeOptions.url);
    const status = API_ERROR_STATUS[failure.code];
    if (status === 401) reply.header('www-authenticate', 'Bearer');
    const response = { error: { code: failure.code, message: failure.code.replaceAll('_', ' '), requestId: request.id,
      retryable: ['RATE_LIMITED', 'CONNECTION_UNAVAILABLE'].includes(failure.code),
      ...(failure.recovery === undefined ? {} : { recovery: failure.recovery }) } };
    return reply.code(status).send(validator.response('ErrorResponse', response));
  });
  app.setNotFoundHandler(async () => { throw new ApiFailure('NOT_FOUND'); });
  if (options.userMemory !== undefined) registerMemoryRoutes(app, options.userMemory, request => {
    const scope = scopes.get(request);
    if (scope === undefined) throw new ApiFailure('AUTHENTICATION_REQUIRED');
    return scope;
  }, validator);
  if (streams !== undefined && options.replay !== undefined) {
    const replay = options.replay;
    app.get('/api/v1/runs/:runId/events', async (request, reply) => {
      const scope = scopes.get(request);
      if (scope === undefined) throw new ApiFailure('AUTHENTICATION_REQUIRED');
      await handleEventStream(request, reply, scope, replay, streams, validator, async () => {
        if (!sameScope(scope, await authenticateRequest(request, options))) throw new ApiFailure('AUTHENTICATION_REQUIRED');
      });
    });
  }
  for (const route of HTTP_ROUTES) {
    app.route({ method: route.method, url: route.url, handler: async (request, reply) => {
      const scope = scopes.get(request);
      if (scope === undefined) throw new ApiFailure('AUTHENTICATION_REQUIRED');
      const result = await handler.execute(scope, apiCall(request, route, validator));
      return reply.code(route.status).send(validator.response(route.response, result));
    } });
  }
  return app;
}

async function authenticateRequest(request: FastifyRequest, options: HttpOptions): Promise<TrustedScope> {
  const header = singleHeader(request, 'authorization');
  if (header === undefined || !/^Bearer [^\s,]+$/i.test(header)) throw new ApiFailure('AUTHENTICATION_REQUIRED');
  const identity = await options.authenticate(header.slice(7));
  if (identity === undefined) throw new ApiFailure('AUTHENTICATION_REQUIRED');
  return scopeFromAuthenticatedIdentity(identity);
}

function frameworkFailure(error: unknown): ApiFailure {
  const code: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') return new ApiFailure('PAYLOAD_TOO_LARGE');
  if (typeof code === 'string' && /^(FST_ERR_CTP_|FST_ERR_BAD_URL)/.test(code)) return new ApiFailure('INVALID_REQUEST');
  return new ApiFailure('INTERNAL_ERROR');
}

/** Unexpected failures were answered with a bare 500 and no trace; log the kind and the first stack line, no payloads. */
function logInternal(error: unknown, requestId: string, route: string | undefined) {
  const detail = error instanceof Error
    ? { name: error.name, message: error.message.slice(0, 300), at: error.stack?.split('\n')[1]?.trim().slice(0, 200) }
    : { name: typeof error };
  console.error(JSON.stringify({ event: 'viper_engine_internal_error', requestId, route: route ?? 'unknown', ...detail }));
}
