import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';

export interface FingerprintDomain {
  readonly domain: string;
  readonly version: string;
}

/** A full SHA-256 content digest; not a signature, MAC, permit, or authentication proof. */
export function createFingerprint(value: unknown, context: FingerprintDomain): string {
  if (typeof context.domain !== 'string' || !/^[a-z][a-z0-9_.:/-]{0,127}$/.test(context.domain)) throw new Error('Invalid fingerprint domain');
  if (typeof context.version !== 'string' || !/^[A-Za-z0-9_.-]{1,32}$/.test(context.version)) throw new Error('Invalid fingerprint version');
  const header = canonicalJson([context.domain, context.version]);
  return createHash('sha256').update('viper-fingerprint\0').update(header).update('\0').update(canonicalJson(value)).digest('hex');
}
