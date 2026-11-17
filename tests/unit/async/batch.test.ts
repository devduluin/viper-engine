import assert from 'node:assert/strict';
import test from 'node:test';
import { mapBounded, settleBounded } from '../../../src/shared/async/batch.js';

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

test('empty input resolves without calling the processor', async () => {
  let calls = 0;
  const processor = async (): Promise<number> => { calls += 1; return 1; };
  assert.deepEqual(await mapBounded([], processor, { concurrency: 3 }), []);
  assert.deepEqual(await settleBounded([], processor, { concurrency: 3 }), []);
  assert.equal(calls, 0);
});

test('results keep input order and the active count never exceeds concurrency', async () => {
  let active = 0;
  let peak = 0;
  const items = [30, 5, 20, 1, 15, 2, 10, 3, 8, 4];
  const result = await mapBounded(items, async (ms, index) => {
    active += 1;
    peak = Math.max(peak, active);
    await pause(ms);
    active -= 1;
    return index * 10;
  }, { concurrency: 3 });
  assert.deepEqual(result, items.map((_, index) => index * 10));
  assert.equal(peak, 3);
});

test('a sliding window starts the next item without waiting for a slow sibling', async () => {
  const events: string[] = [];
  await mapBounded([40, 1, 1, 1], async (ms, index) => {
    events.push(`start ${index}`);
    await pause(ms);
    events.push(`end ${index}`);
  }, { concurrency: 2 });
  assert.ok(events.indexOf('start 3') < events.indexOf('end 0'), events.join(', '));
});

test('invalid concurrency is rejected instead of looping without progress', async () => {
  for (const concurrency of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2']) {
    await assert.rejects(mapBounded([1], async x => x, { concurrency: concurrency as number }), RangeError);
    await assert.rejects(settleBounded([1], async x => x, { concurrency: concurrency as number }), RangeError);
  }
});

test('per-item mode reports partial failures, including synchronous throws, and runs every item', async () => {
  const failure = new Error('item 1 failed');
  const result = await settleBounded([0, 1, 2, 3], (item): Promise<number> => {
    if (item === 1) return Promise.reject(failure);
    if (item === 2) throw new Error('sync throw');
    return Promise.resolve(item);
  }, { concurrency: 2 });
  assert.deepEqual(result[0], { status: 'fulfilled', value: 0 });
  assert.deepEqual(result[1], { status: 'rejected', reason: failure });
  assert.equal(result[2]?.status, 'rejected');
  assert.deepEqual(result[3], { status: 'fulfilled', value: 3 });
});

test('fail-fast stops new launches and rejects only after in-flight siblings settle', async () => {
  const started: number[] = [];
  let slowSiblingDone = false;
  const failure = new Error('first failure');
  const pending = mapBounded([0, 1, 2, 3, 4], async index => {
    started.push(index);
    if (index === 0) throw failure;
    await pause(20);
    if (index === 1) slowSiblingDone = true;
    return index;
  }, { concurrency: 2 });
  await assert.rejects(pending, error => error === failure);
  assert.equal(slowSiblingDone, true, 'in-flight work is awaited, not orphaned');
  assert.deepEqual(started, [0, 1]);
});

test('abort stops new launches; unstarted items are skipped and fail-fast rejects with the reason', async () => {
  const controller = new AbortController();
  const reason = new Error('run cancelled');
  const started: number[] = [];
  const processor = async (index: number): Promise<number> => {
    started.push(index);
    if (index === 1) controller.abort(reason);
    await pause(1);
    return index;
  };
  const settled = await settleBounded([0, 1, 2, 3], processor, { concurrency: 1, signal: controller.signal });
  assert.deepEqual(settled.map(result => result.status), ['fulfilled', 'fulfilled', 'skipped', 'skipped']);
  assert.deepEqual(started, [0, 1]);
  await assert.rejects(mapBounded([0, 1], processor, { concurrency: 1, signal: controller.signal }), error => error === reason);
});

test('abort after every item completed still returns the values', async () => {
  const controller = new AbortController();
  const values = await mapBounded([1, 2], async (item, index) => {
    if (index === 1) controller.abort(new Error('late'));
    return item;
  }, { concurrency: 2, signal: controller.signal });
  assert.deepEqual(values, [1, 2]);
});
