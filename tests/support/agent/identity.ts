import { parseId } from '../../../src/contracts/identity/ids.js';
import type { Clock, IdGenerator } from '../../../src/contracts/identity/ports.js';

/** Inject into each test independently; no global clock or random identifiers. */
export class TestClock implements Clock {
  constructor(private instant = 1_800_000_000_000) {}
  now(): number { return this.instant; }
  advance(ms: number): void {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError('Invalid clock advance');
    if (!Number.isSafeInteger(this.instant + ms)) throw new RangeError('Clock overflow');
    this.instant += ms;
  }
}

export class TestIds implements IdGenerator {
  private count = 0;
  next<Kind extends string>(kind: Kind) {
    this.count += 1;
    return parseId(kind, `test-${kind}-${this.count}`);
  }
}
