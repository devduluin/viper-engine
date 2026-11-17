import assert from 'node:assert/strict';
import { parseId } from '../../../src/contracts/identity/ids.js';
import type { IsolatedDatabase } from './database.js';
import { AT, digest, owner, proposalSnapshot, seedConnection, seedRun, stores } from './fixtures.js';

/** Run + approval-required call + pending approval (own connection per test). */
export async function pendingApproval(db: IsolatedDatabase, suffix: string, expiresAt = AT + 60_000, at = AT) {
  const s = stores(db.pool);
  const tool = await seedConnection(db.pool, owner, `conn-${suffix}`);
  const { runId } = await seedRun(db.pool, owner, suffix);
  const callId = parseId('tool_call', `call-${suffix}`);
  assert.ok((await s.calls.propose(owner, { id: callId, runId, stepId: parseId('step', `step-${suffix}`), tool, argumentsDigest: digest, requiresApproval: true, at })).ok);
  assert.ok((await s.calls.transition(owner, runId, callId, { to: 'awaiting_approval', expectedRevision: 1, at, events: [] })).ok);
  const binding = { runId, toolCallId: callId, tool, argumentsDigest: digest };
  const approvalId = parseId('approval', `ap-${suffix}`);
  const created = await s.approvals.propose(owner, { id: approvalId, binding, ...proposalSnapshot, expiresAt, at, events: [] });
  assert.ok(created.ok);
  return { s, tool, runId, callId, binding, approvalId, approval: created.value };
}
