import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { JsonObject } from '../../../src/contracts/messages/json.js';
import { parseJsonObject } from '../../../src/contracts/messages/json.js';
import { createEngineHttpServer } from '../../../src/bootstrap/http.js';
import type { EngineHttpOptions } from '../../../src/bootstrap/http.js';
import type { SqlPool } from '../../../src/adapters/persistence/postgres/sql-client.js';
import { owner, other, tenanted } from './fixtures.js';
import { assertValid } from '../../contract/api/validate.js';

export const INPUT = { input: { content: [{ type: 'text', text: 'Perform this task' }] } };
export const secret = Buffer.alloc(32, 7);
export function http(pool: SqlPool, overrides: Partial<EngineHttpOptions> = {}) {
  return createEngineHttpServer(pool, { cursorSecret: secret, authorizeServer: async () => 'ready',
    authenticate: async token => ({ owner, other, tenant: tenanted })[token as 'owner' | 'other' | 'tenant'], ...overrides });
}

export async function request(app: FastifyInstance, method: 'GET' | 'POST', url: string, payload?: object,
  extra: { token?: string; key?: string; status?: number; schema?: string } = {}): Promise<JsonObject> {
  const response = await app.inject({ method, url, headers: { authorization: `Bearer ${extra.token ?? 'owner'}`,
    ...(extra.key === undefined ? {} : { 'idempotency-key': extra.key }) }, ...(payload === undefined ? {} : { payload }) });
  if (extra.status !== undefined) assert.equal(response.statusCode, extra.status, response.body);
  const body = parseJsonObject(response.json());
  if (extra.schema !== undefined) assertValid(extra.schema, body);
  if (response.statusCode >= 400) assertValid('ErrorResponse', body);
  assert.ok(response.headers['x-request-id']);
  return body;
}
export const field = (body: JsonObject, key: string): string => {
  const value = body[key]; assert.equal(typeof value, 'string'); return String(value);
};
export const errorCode = (body: JsonObject) => parseJsonObject(body['error'])['code'];

export async function newConversation(app: FastifyInstance) {
  return field(await request(app, 'POST', '/api/v1/conversations', { title: 'Test' }, { status: 201, schema: 'ConversationSnapshot' }), 'conversationId');
}

export async function start(app: FastifyInstance, conversationId: string, key = 'key-1') {
  return request(app, 'POST', `/api/v1/conversations/${encodeURIComponent(conversationId)}/runs`, INPUT,
    { key, status: 202, schema: 'RunAccepted' });
}
