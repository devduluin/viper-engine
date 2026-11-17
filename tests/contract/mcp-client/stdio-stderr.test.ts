import assert from 'node:assert/strict';
import test from 'node:test';
import { McpSession } from '../../../src/adapters/mcp/client/session.js';
import { STDERR_TAIL_CHARS, createTransport, stderrTail } from '../../../src/adapters/mcp/client/transport.js';

const crash = (script: string) => ({ kind: 'stdio' as const, command: process.execPath, args: ['-e', script] });

test('a crashing stdio server: connect fails and the error carries its stderr tail, not in the message', async () => {
  const error = await McpSession.open(crash("console.error('boom: missing module'); process.exit(3)"), { connectTimeoutMs: 5_000 })
    .then(() => assert.fail('connect should fail'), (caught: unknown) => caught as Error & { stderr?: string });
  assert.match(String(error.stderr), /boom: missing module/);
  assert.doesNotMatch(error.message, /boom/);
  assert.equal(Object.keys(error).includes('stderr'), false);
});

test('captured stderr is always drained and bounded, so a chatty server cannot block', async () => {
  const transport = createTransport(crash("process.stderr.write('x'.repeat(200000) + 'END'); setTimeout(() => process.exit(0), 50)"));
  const closed = new Promise<void>(resolve => { transport.onclose = () => resolve(); });
  await transport.start();
  await closed;
  const tail = stderrTail(transport);
  assert.ok(tail !== undefined && tail.length <= STDERR_TAIL_CHARS && tail.endsWith('END'));
});

test('ignore/inherit keep the SDK behaviour and expose no tail', () => {
  assert.equal(stderrTail(createTransport({ ...crash(''), stderr: 'ignore' })), undefined);
  assert.equal(stderrTail(createTransport({ kind: 'streamable_http', url: 'http://127.0.0.1:1/mcp' })), undefined);
});
