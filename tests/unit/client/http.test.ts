import assert from 'node:assert/strict';
import { test } from 'node:test';
import { client, json, snapshot, failure } from '../../support/client/fixtures.js';
import { createEngineClient } from '../../../src/bootstrap/client.js';

test('client constructs offline and sends strict JSON with a fresh bearer and idempotency key', async () => {
  let calls = 0; let tokens = 0;
  const api = client(async (url, init) => {
    calls++; assert.equal(String(url), 'http://127.0.0.1:9999/api/v1/conversations/conversation-1/runs');
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    const headers = new Headers(init?.headers); assert.equal(headers.get('authorization'), `Bearer token-${tokens}`);
    assert.equal(headers.get('idempotency-key'), 'same-key'); assert.deepEqual(JSON.parse(String(init?.body)), { input: { content: [{ type: 'text', text: 'Hi' }] } });
    return json({ schemaVersion: 1, runId: 'run-1', conversationId: 'conversation-1', revision: 1, status: 'queued', snapshotUrl: '/api/v1/runs/run-1' }, 202);
  }, { getToken: async () => `token-${++tokens}` });
  assert.equal(calls, 0);
  for (let i = 0; i < 2; i++) await api.startRun('conversation-1', { input: { content: [{ type: 'text', text: 'Hi' }] } }, 'same-key');
  assert.equal(calls, 2); assert.equal(tokens, 2);
});

test('mutation timeout/network failure does not retry or reveal credentials', async () => {
  let calls = 0;
  const api = client(async () => { calls++; throw new Error('private-token upstream diagnostics'); });
  await assert.rejects(api.createConversation(), failure('NETWORK_ERROR')); assert.equal(calls, 1);
  const timed = client(() => new Promise(() => undefined), { requestTimeoutMs: 10 });
  await assert.rejects(timed.cancel('run-1'), failure('TIMEOUT'));
});

test('response allows future optional fields but validates known fields and version', async () => {
  await client(async () => json({ ...snapshot(), future: { flag: true } })).run('run-1');
  for (const invalid of [{ ...snapshot(), revision: 'wrong' }, { ...snapshot(), schemaVersion: 2 },
    { ...snapshot(), finalMessage: { id: 'message-1', role: 'assistant', content: [], toolCalls: 'wrong' } }]) {
    await assert.rejects(client(async () => json(invalid)).run('run-1'), failure('INVALID_RESPONSE'));
  }
});

test('strict request validation happens before authentication or fetch', async () => {
  const api = client(async () => { throw new Error('Should not fetch'); }, { getToken: async () => { throw new Error('Should not authenticate'); } });
  await assert.rejects(async () => api.createConversation({ title: 'Hi', actorId: 'forged' } as { title: string }), failure('INVALID_REQUEST'));
  await assert.rejects(async () => api.startRun('conversation-1', { input: { content: [] } }, ''), failure('INVALID_REQUEST'));
  await assert.rejects(async () => api.run('..'), failure('INVALID_REQUEST'));
});

test('JSON body bounds apply to streaming and declared size, including multibyte input', async () => {
  const body = JSON.stringify(snapshot());
  await assert.rejects(client(async () => json(snapshot()), { responseBytes: body.length - 1 }).run('run-1'), failure('PAYLOAD_TOO_LARGE'));
  await assert.rejects(client(async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1000' } }),
    { responseBytes: 100 }).run('run-1'), failure('PAYLOAD_TOO_LARGE'));
  await assert.rejects(client(async () => { throw new Error('Must not fetch'); }, { requestBytes: 10 }).createConversation({ title: 'é'.repeat(10) }), failure('PAYLOAD_TOO_LARGE'));
});

test('structured errors preserve recovery without echoing server diagnostics; unknown errors are generic', async () => {
  const api = client(async () => json({ error: { code: 'REVISION_CONFLICT', message: 'private details', requestId: 'request-1', retryable: false,
    recovery: { action: 'refresh_revision', currentRevision: 5 } } }, 409));
  await assert.rejects(api.cancel('run-1'), error => {
    assert.ok(failure('REVISION_CONFLICT')(error)); assert.equal(Reflect.get(Object(error), 'status'), 409);
    assert.deepEqual(Reflect.get(Object(error), 'recovery'), { action: 'refresh_revision', currentRevision: 5 }); return true;
  });
  await assert.rejects(client(async () => new Response('private server HTML', { status: 502 })).run('run-1'), failure('HTTP_ERROR'));
});

test('caller abort and response type failures are explicit', async () => {
  const stopped = new AbortController(); stopped.abort(); let calls = 0;
  await assert.rejects(client(async () => { calls++; return json(snapshot()); }).run('run-1', { signal: stopped.signal }), failure('CANCELLED'));
  assert.equal(calls, 0);
  await assert.rejects(client(async () => new Response('{}')).run('run-1'), failure('INVALID_RESPONSE'));
  await assert.rejects(client(async () => json(snapshot(), 201)).run('run-1'), failure('INVALID_RESPONSE'));
});

test('rejects unsafe origins, URL credentials, malformed tokens and bounds without I/O', async () => {
  for (const baseUrl of ['http://remote.example', 'https://user:private@example.com', 'https://example.com/path', 'private bad URL']) {
    assert.throws(() => createEngineClient({ baseUrl, getToken: async () => 'token' }), failure('INVALID_REQUEST'));
  }
  await assert.rejects(client(async () => json(snapshot()), { getToken: async () => 'private token\n' }).run('run-1'), failure('AUTHENTICATION_REQUIRED'));
  assert.throws(() => client(async () => json(snapshot()), { requestTimeoutMs: -1 }), failure('INVALID_REQUEST'));
});
