import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import { testContext } from '../../support/agent/setup.js';
import { harness, run, runtimeTool, callsOf, finalText, StubMcp, success } from '../runtime/harness.js';
import { TOOL_SEARCH_NAME } from '../../../src/contracts/discovery/state.js';

test('compression retains complete discovery exchanges without changing canonical checkpoint sources', async () => {
  const base = testContext();
  const old = Array.from({ length: 20 }, (_, i) => [
    parseMessage({ id: `old-u-${i}`, role: 'user', content: [{ type: 'text', text: 'old text '.repeat(200) }] }),
    parseMessage({ id: `old-a-${i}`, role: 'assistant', content: [{ type: 'text', text: 'old answer '.repeat(200) }] }),
  ]).flat();
  const messages = [...old, ...base.history.messages];
  const h = harness([callsOf(['search', TOOL_SEARCH_NAME, { query: 'lookup' }]), callsOf(['actual', 'lookup']), finalText('Done')],
    new StubMcp(() => success({})), { input: { tools: [runtimeTool('lookup')], toolDiscovery: { mode: 'on' },
      history: { ...base.history, messages }, context: { windowTokens: 5000, framingReserveTokens: 500, maxSummaryBytes: 1024, recentTurns: 1 } } });
  const result = await run(h); assert.equal(result.status, 'completed');
  assert.ok(h.model.requests[1]!.messages.length < messages.length);
  const projected = h.model.requests[1]!.messages;
  assert.ok(projected.some(message => message.role === 'tool' && message.toolCallId === 'search'));
  assert.equal(h.input.history.messages.length, 41); assert.equal(messages.length, 41);
});
