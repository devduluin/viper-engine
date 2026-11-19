import { lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { object, text } from './validation.js';

export function evidenceBytes(directory: string, name: string): Buffer {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(json|tap|txt)$/.test(name)) throw new Error('Invalid evidence filename');
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Symlinked evidence directory');
  const target = path.join(directory, name); const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid/oversized evidence file');
  return readFileSync(target);
}
export const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function evidenceJson(directory: string, name: string) { return object(JSON.parse(evidenceBytes(directory, name).toString('utf8'))); }
export function verifyFiles(directory: string, value: unknown) {
  const input = object(value); const names = Object.keys(input);
  if (names.length < 1 || names.length > 4096) throw new Error('Missing/oversized evidence manifest');
  const hashes: Record<string, string> = {};
  for (const name of names) {
    const expected = text(input[name]); if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('Invalid evidence SHA256');
    if (digest(evidenceBytes(directory, name)) !== expected) throw new Error(`Evidence checksum mismatch: ${name}`);
    hashes[name] = expected;
  }
  return hashes;
}
