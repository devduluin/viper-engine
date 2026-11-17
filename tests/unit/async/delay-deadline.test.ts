import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { withDeadline } from '../../../src/shared/async/deadline.js';
import { delay, MAX_TIMER_DELAY_MS } from '../../../src/shared/async/delay.js';
import { DeadlineExceededError } from '../../../src/shared/async/errors.js';

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const activeTimers = (): number => process.getActiveResourcesInfo().filter(kind => kind === 'Timeout').length;
const never = (): Promise<never> => new Promise<never>(() => undefined);

test('delay resolves after the duration and zero delay is still asynchronous', async () => {
  let done = false;
  const pending = delay(0).then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  await pending;
  assert.equal(done, true);
  const started = performance.now();
  await delay(20);
  assert.ok(performance.now() - started >= 15);
});

test('delay rejects invalid durations synchronously', () => {
  const invalid: unknown[] = [-1, Number.NaN, Number.POSITIVE_INFINITY, MAX_TIMER_DELAY_MS + 1, '5'];
  for (const ms of invalid) assert.throws(() => delay(ms as number), RangeError);
});

test('delay abort rejects with the reason and cleans its timer and listener', async () => {
  const before = activeTimers();
  const controller = new AbortController();
  const pending = delay(60_000, { signal: controller.signal });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  const reason = new Error('stop');
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(activeTimers(), before);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  await assert.rejects(delay(10, { signal: controller.signal }), error => error === reason);
});

test('delay removes its abort listener after resolving', async () => {
  const controller = new AbortController();
  await delay(1, { signal: controller.signal });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('deadline returns the value and clears its timer and caller listener', async () => {
  const before = activeTimers();
  const controller = new AbortController();
  const options = { timeoutMs: 60_000, operationName: 'read', signal: controller.signal };
  assert.equal(await withDeadline(async () => 42, options), 42);
  assert.equal(activeTimers(), before);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('deadline timeout rejects and aborts the operation signal with the same error', async () => {
  let seen: AbortSignal | undefined;
  const pending = withDeadline(signal => { seen = signal; return never(); }, { timeoutMs: 5, operationName: 'fetchData' });
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof DeadlineExceededError);
    assert.equal(error.message, 'fetchData timed out after 5ms');
    assert.equal(error.timeoutMs, 5);
    return true;
  });
  assert.equal(seen?.aborted, true);
  assert.ok(seen?.reason instanceof DeadlineExceededError);
});

test('timeout is not cancellation: work ignoring the signal keeps running after the caller gives up', async () => {
  let underlyingSettled = false;
  const operation = async (): Promise<string> => {
    await pause(30);
    underlyingSettled = true;
    throw new Error('late failure must not become an unhandled rejection');
  };
  await assert.rejects(withDeadline(operation, { timeoutMs: 5, operationName: 'write' }), DeadlineExceededError);
  assert.equal(underlyingSettled, false);
  await pause(50);
  assert.equal(underlyingSettled, true);
});

test('deadline propagates caller abort and never starts after a prior abort', async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  const pending = withDeadline(signal => { seen = signal; return never(); }, {
    timeoutMs: 60_000, operationName: 'op', signal: controller.signal,
  });
  const reason = new Error('client cancelled');
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(seen?.reason, reason);
  let called = false;
  const late = withDeadline(async () => { called = true; }, { timeoutMs: 10, operationName: 'op', signal: controller.signal });
  await assert.rejects(late, error => error === reason);
  assert.equal(called, false);
});

test('deadline passes operation errors through unchanged, including synchronous throws', async () => {
  const failure = new Error('remote isError');
  const options = { timeoutMs: 1_000, operationName: 'op' };
  await assert.rejects(withDeadline(() => Promise.reject(failure), options), error => error === failure);
  await assert.rejects(withDeadline(() => { throw failure; }, options), error => error === failure);
  assert.throws(() => withDeadline(async () => 1, { timeoutMs: -1, operationName: 'op' }), RangeError);
});
