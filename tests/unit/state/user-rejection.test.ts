import assert from 'node:assert/strict';
import { test } from 'node:test';
import { userDeclined, parseToolFailureCode } from '../../../src/contracts/state/tool-rejection.js';
import { parseMcpFailure } from '../../../src/contracts/mcp/parse-outcome.js';
import { parseId } from '../../../src/contracts/identity/ids.js';
import { approvalRecord, binding, digestB, scope } from './fixtures.js';
import { initialState, decodeState, encodeState } from '../../../src/application/durable/state.js';

test('only a matching server-owned rejected approval describes a user decline', () => {
  const record = approvalRecord({ status: 'rejected' }); const reason = userDeclined(scope(), record, binding());
  assert.equal(reason?.code, 'rejected_by_user'); assert.match(reason?.message ?? '', /user declined/i);
  assert.ok(Object.isFrozen(reason));
  for (const status of ['pending', 'accepted', 'expired', 'superseded', 'consumed'] as const) {
    assert.equal(userDeclined(scope(), approvalRecord({ status }), binding()), undefined);
  }
});

test('user-declined evidence binds ownership, run, call, tool version and final arguments', () => {
  const record = approvalRecord({ status: 'rejected' });
  for (const candidate of [binding({ runId: parseId('run', 'different') }), binding({ toolCallId: parseId('tool_call', 'different') }),
    binding({ argumentsDigest: digestB }), binding({ tool: { ...binding().tool, definitionVersion: 'v2' } }),
    binding({ tool: { ...binding().tool, connectionId: parseId('mcp_connection', 'other') } })]) {
    assert.equal(userDeclined(scope(), record, candidate), undefined);
  }
  assert.equal(userDeclined(scope('other'), record, binding()), undefined);
  assert.equal(userDeclined(scope('actor-1', 'tenant'), record, binding()), undefined);
});

test('host rejection code is accepted in durable planning reports but remains outside MCP failures', () => {
  assert.equal(parseToolFailureCode('rejected_by_user'), 'rejected_by_user'); assert.equal(parseToolFailureCode('permission'), 'permission');
  assert.throws(() => parseMcpFailure({ code: 'rejected_by_user', message: 'Remote claim', retryable: false }));
  assert.throws(() => parseToolFailureCode('unrecognized'));
  const state = initialState({ model: 'fixture', maxModelCalls: 8, maxOutputTokens: 100 }, 0);
  state.reports = [{ id: parseId('tool_call', 'call'), name: 'save', status: 'rejected', failureCode: 'rejected_by_user' }];
  assert.deepEqual(decodeState(encodeState(state)).reports, state.reports);
  state.reports = [{ ...state.reports[0]!, status: 'unknown' }];
  assert.throws(() => decodeState(encodeState(state)), /rejected report/);
});
