import assert from 'node:assert/strict';
import test from 'node:test';
import { RetryError } from '../../../src/shared/async/errors.js';
import { backoffDelay, DEFAULT_RETRY_TIMING, withRetry } from '../../../src/shared/async/retry.js';
import type { RetryEvent, RetryPolicy } from '../../../src/shared/async/retry.js';

const retryAll: RetryPolicy = { ...DEFAULT_RETRY_TIMING, shouldRetry: () => true };

function recorder(): { waits: number[]; wait: (ms: number) => Promise<void> } {
  const waits: number[] = [];
  return { waits, wait: async (ms: number) => { waits.push(ms); } };
}

function failingTimes(failures: number, value = 'ok'): { calls: () => number; op: () => Promise<string> } {
  let calls = 0;
  return {
    calls: () => calls,
    op: async () => {
      calls += 1;
      if (calls <= failures) throw new Error(`failure ${calls}`);
      return value;
    },
  };
}

test('immediate success reports one attempt and never waits', async () => {
  const { waits, wait } = recorder();
  const result = await withRetry(async () => 'v', retryAll, { operationName: 'op', wait });
  assert.deepEqual(result, { value: 'v', attempts: 1 });
  assert.deepEqual(waits, []);
});

test('success after failures reports actual attempts with deterministic capped backoff', async () => {
  const { waits, wait } = recorder();
  const subject = failingTimes(2);
  const result = await withRetry(subject.op, retryAll, { operationName: 'op', wait, random: () => 0 });
  assert.deepEqual(result, { value: 'ok', attempts: 3 });
  assert.deepEqual(waits, [500, 1_000]);
});

test('nonretryable error calls once and preserves the original cause', async () => {
  const original = new Error('HTTP 503 network timeout');
  let calls = 0;
  const policy: RetryPolicy = { ...DEFAULT_RETRY_TIMING, shouldRetry: () => false };
  const pending = withRetry(async () => { calls += 1; throw original; }, policy, { operationName: 'write' });
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof RetryError);
    assert.equal(error.reason, 'not_retryable');
    assert.equal(error.attempts, 1);
    assert.equal(error.cause, original);
    return true;
  });
  assert.equal(calls, 1, 'transient-looking message text must not override the policy');
});

test('exhaustion stops at maxAttempts and does not consult the policy after the last call', async () => {
  const { wait } = recorder();
  const subject = failingTimes(10);
  const consulted: number[] = [];
  const policy: RetryPolicy = { ...DEFAULT_RETRY_TIMING, shouldRetry: (_error, attempt) => { consulted.push(attempt); return true; } };
  await assert.rejects(withRetry(subject.op, policy, { operationName: 'op', wait }), (error: unknown) => {
    assert.ok(error instanceof RetryError);
    assert.equal(error.reason, 'exhausted');
    assert.equal(error.attempts, 3);
    assert.equal((error.cause as Error).message, 'failure 3');
    assert.match(error.message, /op failed after 3 attempt\(s\)/);
    return true;
  });
  assert.equal(subject.calls(), 3);
  assert.deepEqual(consulted, [1, 2]);
});

test('backoff doubles, adds bounded jitter and respects the cap; defaults mirror legacy maxRetries 2', () => {
  assert.equal(DEFAULT_RETRY_TIMING.maxAttempts, 3);
  assert.equal(backoffDelay(DEFAULT_RETRY_TIMING, 1, () => 0.5), 550);
  assert.equal(backoffDelay(DEFAULT_RETRY_TIMING, 3, () => 0), 2_000);
  assert.equal(backoffDelay(DEFAULT_RETRY_TIMING, 5, () => 0.99), 5_000);
});

test('abort while waiting rejects with the reason and starts no further attempt', async () => {
  const controller = new AbortController();
  const subject = failingTimes(10);
  const policy: RetryPolicy = { ...retryAll, baseDelayMs: 60_000, maxDelayMs: 60_000 };
  const pending = withRetry(subject.op, policy, { operationName: 'op', signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 5));
  const reason = new Error('cancelled');
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(subject.calls(), 1);
  const late = failingTimes(0);
  await assert.rejects(withRetry(late.op, retryAll, { operationName: 'op', signal: controller.signal }), error => error === reason);
  assert.equal(late.calls(), 0);
});

test('retry observer receives events and its failures do not change control flow', async () => {
  const events: RetryEvent[] = [];
  const { wait } = recorder();
  const subject = failingTimes(1);
  const onRetry = (event: RetryEvent): void => { events.push(event); throw new Error('logger down'); };
  const result = await withRetry(subject.op, retryAll, { operationName: 'op', wait, onRetry, random: () => 0 });
  assert.equal(result.attempts, 2);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.attempt, 1);
  assert.equal(events[0]?.delayMs, 500);
});

test('invalid policies are rejected before the operation runs', async () => {
  const invalid: unknown[] = [
    { ...retryAll, maxAttempts: 0 }, { ...retryAll, maxAttempts: 1.5 }, { ...retryAll, maxAttempts: Number.NaN },
    { ...retryAll, baseDelayMs: -1 }, { ...retryAll, maxJitterMs: Number.POSITIVE_INFINITY },
    { ...DEFAULT_RETRY_TIMING },
  ];
  let calls = 0;
  for (const policy of invalid) {
    await assert.rejects(withRetry(async () => { calls += 1; }, policy as RetryPolicy, { operationName: 'op' }));
  }
  assert.equal(calls, 0);
});
