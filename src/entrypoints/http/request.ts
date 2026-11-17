import type { FastifyRequest } from 'fastify';
import type { HttpRoute } from './routes.js';
import type { ApiCall } from '../../contracts/api/control.js';
import { ApiFailure } from '../../contracts/api/failure.js';
import { parseId } from '../../contracts/identity/ids.js';
import { readJsonRecord } from '../../contracts/messages/json.js';
import type { apiValidation } from './schema-validation.js';

export function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const occurrences = request.raw.rawHeaders.filter((_, index) => index % 2 === 0 && request.raw.rawHeaders[index]?.toLowerCase() === name);
  const value = request.headers[name];
  if (occurrences.length > 1 || Array.isArray(value)) throw new ApiFailure('INVALID_REQUEST');
  return value;
}

export function apiCall(request: FastifyRequest, route: HttpRoute, validator: ReturnType<typeof apiValidation>): ApiCall {
  const body = route.body === undefined ? {} : validator.request(route.body, request.body);
  const params = frameworkRecord(request.params); const query = frameworkRecord(request.query);
  const resource = route.resource === undefined ? undefined : resourceId(params[route.resource]);
  const page = pagination(query, route.paged === true);
  const key = route.operation === 'startRun' ? singleHeader(request, 'idempotency-key') : undefined;
  if (route.operation === 'startRun' && (key === undefined || !/^[!-~]{1,128}$/.test(key))) throw new ApiFailure('INVALID_REQUEST');
  return { operation: route.operation, body, ...page,
    ...(resource === undefined ? {} : { resourceId: resource }), ...(key === undefined ? {} : { key }) };
}

/** Fastify's router/query objects use framework-owned prototypes, unlike JSON request bodies. */
export function frameworkRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ApiFailure('INVALID_REQUEST');
  return readJsonRecord(Object.fromEntries(Object.entries(value)));
}

export function resourceId(value: unknown): string {
  try { return parseId('api_resource', value); } catch { throw new ApiFailure('INVALID_REQUEST'); }
}

function pagination(query: Record<string, unknown>, paged: boolean): { readonly cursor?: string; readonly limit?: number } {
  if (Object.keys(query).some(key => !paged || !['cursor', 'limit'].includes(key))) throw new ApiFailure('INVALID_REQUEST');
  const cursor = query['cursor']; const limit = query['limit'];
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(cursor))) throw new ApiFailure('INVALID_CURSOR');
  if (limit !== undefined && (typeof limit !== 'string' || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(limit))) throw new ApiFailure('INVALID_REQUEST');
  return { ...(typeof cursor !== 'string' ? {} : { cursor }), ...(typeof limit !== 'string' ? {} : { limit: Number(limit) }) };
}
