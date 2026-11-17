import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workerInstructions } from '../../../src/bootstrap/worker/instructions.js';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { RunCheckpoint } from '../../../src/contracts/state/checkpoints.js';
import { ownerFromScope } from '../../../src/contracts/state/owner.js';
import { testScope } from '../../support/agent/setup.js';

test('saved instructions dedup identical identities and never overwrite conflicting host instructions', async () => {
  const scope = testScope(); const cp: RunCheckpoint = { run: { id: parseId('run', 'r'), conversationId: parseId('conversation', 'c'),
    status: 'queued', revision: 1, owner: ownerFromScope(scope), createdAt: 1, updatedAt: 1 },
    conversationRevision: 1, history: [], runMessageIds: [], toolCalls: [], approvals: [], lastEventSequence: 0 };
  const trusted = parseMessage({ id: 'same-id', role: 'system', content: [{ type: 'text', text: 'Host instructions' }] });
  const exact = workerInstructions([trusted], async () => [trusted]);
  assert.deepEqual(await exact(scope, cp), [trusted]);
  const changed = parseMessage({ id: 'same-id', role: 'system', content: [{ type: 'text', text: 'Conflicting instructions' }] });
  await assert.rejects(workerInstructions([trusted], async () => [changed])(scope, cp), /Conflicting instruction identity/);
});
