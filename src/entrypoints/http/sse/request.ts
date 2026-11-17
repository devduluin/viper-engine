import type { FastifyRequest } from 'fastify';
import { parseId } from '../../../contracts/identity/ids.js';
import { ApiFailure } from '../../../contracts/api/failure.js';
import { frameworkRecord, resourceId, singleHeader } from '../request.js';

export function streamRequest(request: FastifyRequest) {
  const params = frameworkRecord(request.params); const query = frameworkRecord(request.query);
  if (Object.keys(query).some(key => key !== 'cursor')) throw new ApiFailure('INVALID_REQUEST');
  const header = cursorValue(singleHeader(request, 'last-event-id')); const cursor = cursorValue(query['cursor']);
  if (header !== undefined && cursor !== undefined && header !== cursor) throw new ApiFailure('INVALID_REQUEST');
  const selected = cursor ?? header;
  return { runId: parseId('run', resourceId(params['runId'])), ...(selected === undefined ? {} : { cursor: selected }) };
}

function cursorValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(value)) throw new ApiFailure('INVALID_CURSOR');
  return value;
}
