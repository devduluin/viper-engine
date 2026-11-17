// Provenance: ai-intent-api-v2/src/utils/async-helpers.util.ts `processInBatches`
// SHA-256 44310795f05543c37d0b359325d9ed6d63dcc5d7a42bdc36d875252a6d1d5b1c (P02-02 adaptation).
// Changes: sliding window instead of chunk barriers, validated concurrency, explicit fail-fast vs
// per-item modes, cancellation stops new launches, in-flight work is awaited (never orphaned).

export type BatchItemResult<R> =
  | { readonly status: 'fulfilled'; readonly value: R }
  | { readonly status: 'rejected'; readonly reason: unknown }
  | { readonly status: 'skipped' };

export interface BatchOptions {
  /** Maximum operations in flight; a positive integer. */
  readonly concurrency: number;
  readonly signal?: AbortSignal;
}

export type BatchProcessor<T, R> = (item: T, index: number, signal?: AbortSignal) => Promise<R>;

const SKIPPED: BatchItemResult<never> = Object.freeze({ status: 'skipped' });

/**
 * Per-item mode: runs every item (bounded) and returns outcomes in input order. Never rejects
 * because a processor failed. After abort no new item starts; unstarted items are `skipped`.
 */
export async function settleBounded<T, R>(
  items: readonly T[],
  processor: BatchProcessor<T, R>,
  options: BatchOptions,
): Promise<BatchItemResult<R>[]> {
  return (await runPool(items, processor, options, false)).results;
}

/**
 * Fail-fast mode: resolves values in input order. The first failure stops new launches;
 * after in-flight items settle it rejects with that first error. Abort rejects with
 * `signal.reason`. A failure never rolls back sibling items that already ran.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  processor: BatchProcessor<T, R>,
  options: BatchOptions,
): Promise<R[]> {
  const run = await runPool(items, processor, options, true);
  if (run.failure !== undefined) throw run.failure.reason;
  return run.results.map(result => {
    // Only abort leaves items unstarted once no failure occurred.
    if (result.status !== 'fulfilled') throw options.signal?.reason;
    return result.value;
  });
}

interface PoolRun<R> {
  readonly results: BatchItemResult<R>[];
  readonly failure: { readonly reason: unknown } | undefined;
}

async function runPool<T, R>(
  items: readonly T[],
  processor: BatchProcessor<T, R>,
  options: BatchOptions,
  stopOnError: boolean,
): Promise<PoolRun<R>> {
  assertConcurrency(options.concurrency);
  const { signal } = options;
  const results: BatchItemResult<R>[] = items.map(() => SKIPPED);
  let next = 0;
  let failure: PoolRun<R>['failure'];
  const canLaunch = (): boolean =>
    next < items.length && signal?.aborted !== true && !(stopOnError && failure !== undefined);
  const worker = async (): Promise<void> => {
    while (canLaunch()) {
      const index = next;
      next += 1;
      results[index] = await settleItem(processor, items[index] as T, index, signal);
      const settled = results[index];
      if (settled?.status === 'rejected' && failure === undefined) failure = { reason: settled.reason };
    }
  };
  const workerCount = Math.min(options.concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return { results, failure };
}

async function settleItem<T, R>(
  processor: BatchProcessor<T, R>,
  item: T,
  index: number,
  signal: AbortSignal | undefined,
): Promise<BatchItemResult<R>> {
  try {
    return { status: 'fulfilled', value: await processor(item, index, signal) };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

function assertConcurrency(concurrency: unknown): void {
  if (typeof concurrency !== 'number' || !Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive safe integer');
  }
}
