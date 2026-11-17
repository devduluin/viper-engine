import type { EntityId } from './ids.js';

/** Adapter supplies Unix epoch milliseconds; no system clock is constructed here. */
export interface Clock {
  now(): number;
}

/** Implementations generate and validate opaque IDs; uniqueness is the adapter's responsibility. */
export interface IdGenerator {
  next<Kind extends string>(kind: Kind): EntityId<Kind>;
}
