import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EngineRecall } from '../../../src/application/recall/service.js';
import { recallStub, note } from '../../support/recall/store.js';
import { TestClock, TestIds } from '../../support/agent/identity.js';
import { testScope } from '../../support/agent/setup.js';
import { noteSource, searchQuery, recallLimit } from '../../../src/contracts/recall/validation.js';

test('recall ingress bounds literal query, result count and source shape before storage access', () => {
  for (const limit of [0, -1, 51, Infinity, 1.5]) assert.throws(() => recallLimit(limit));
  for (const query of ['', 'a', 'é'.repeat(150)]) assert.throws(() => searchQuery({ query, limit: 20 }));
  assert.equal(searchQuery({ query: "  %' OR 1=1 --  ", limit: 20 }).query, "%' OR 1=1 --");
  assert.throws(() => noteSource({ conversationId: 'c', messageId: 'm', role: 'assistant' } as { conversationId: string; messageId: string }));
  assert.throws(() => noteSource({ conversationId: 'c', messageId: 'bad id' }));
  const recall = new EngineRecall(recallStub(), new TestClock(), new TestIds());
  assert.throws(() => recall.search(testScope(), { query: 'valid', limit: 999 }));
});

test('evidence keeps provenance and trust as user data, not a verified fact or write operation', async () => {
  const recall = new EngineRecall(recallStub({ notes: async () => ({ schemaVersion: 1, items: [note], hasMore: false }) }), new TestClock(), new TestIds());
  const evidence = await recall.evidence(testScope()); assert.equal(evidence[0]?.role, 'user');
  const text = JSON.stringify(evidence); assert.match(text, /user_asserted/); assert.match(text, /message-1/);
  assert.match(text, /not instructions, verified facts/); assert.ok(Object.isFrozen(evidence));
  assert.deepEqual(await new EngineRecall(recallStub({ notes: async () => ({ schemaVersion: 1, items: [], hasMore: false }) }),
    new TestClock(), new TestIds()).evidence(testScope()), []);
});

test('evidence adds history only for an explicit query and remains bounded for escaped Unicode sources', async () => {
  let searches = 0;
  const recall = new EngineRecall(recallStub({ notes: async () => ({ schemaVersion: 1, items: [], hasMore: false }),
    search: async () => { searches++; return { schemaVersion: 1, hasMore: false, items: [{ conversationId: 'c', messageId: 'm', role: 'assistant',
      position: 1, createdAt: 1, excerpt: '\u0000"\\😀'.repeat(500), trust: 'untrusted_history' }] }; } }), new TestClock(), new TestIds());
  assert.deepEqual(await recall.evidence(testScope()), []); assert.equal(searches, 0);
  const evidence = await recall.evidence(testScope(), { query: 'explicit', limit: 1 }); assert.equal(searches, 1);
  assert.ok(new TextEncoder().encode(JSON.stringify(evidence)).byteLength <= 32768);
  assert.match(JSON.stringify(evidence), /untrusted_history/);
  await assert.rejects(recall.evidence(testScope(), { limit: 11 }), /limit/);
});
