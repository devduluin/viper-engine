import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { UserMemoryPort } from '../../contracts/recall/user-memory.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { ApiFailure } from '../../contracts/api/failure.js';
import { parseId } from '../../contracts/identity/ids.js';
import type { apiValidation } from './schema-validation.js';
import { frameworkRecord } from './request.js';

/** Same bearer authentication/no-store boundary as the main API. Scope never comes from request JSON. */
export function registerMemoryRoutes(app: FastifyInstance, memory: UserMemoryPort,
  scopeFor: (request: FastifyRequest) => TrustedScope, validate: ReturnType<typeof apiValidation>) {
  app.get('/api/v1/memory', async request => {
    const query = validate.request('MemoryListRequest', frameworkRecord(request.query));
    return validate.response('MemoryPage', await memory.list(scopeFor(request), query['query'] as string | undefined));
  });
  app.post('/api/v1/memory', async request => {
    const body = validate.request('MemorySaveRequest', request.body);
    return validate.response('MemoryNote', await memory.save(scopeFor(request), {
      text: String(body['text']), requestId: String(body['requestId']) }));
  });
  app.post('/api/v1/memory/:noteId/correct', async request => {
    const body = validate.request('MemoryCorrectRequest', request.body);
    return validate.response('MemoryNote', await memory.save(scopeFor(request), { noteId: noteId(request),
      text: String(body['text']), requestId: String(body['requestId']), expectedRevision: Number(body['expectedRevision']) }));
  });
  app.post('/api/v1/memory/:noteId/delete', async request => {
    const body = validate.request('MemoryDeleteRequest', request.body);
    return validate.response('MemoryNote', await memory.delete(scopeFor(request), noteId(request), {
      requestId: String(body['requestId']), expectedRevision: Number(body['expectedRevision']) }));
  });
}
function noteId(request: FastifyRequest) {
  try { return parseId('note', frameworkRecord(request.params)['noteId']); }
  catch { throw new ApiFailure('INVALID_REQUEST'); }
}
