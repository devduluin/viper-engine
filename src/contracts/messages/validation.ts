import { isPlainRecord, readJsonArray, readJsonRecord } from './json.js';

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error(`Invalid ${label}`);
  return readJsonRecord(value);
}

export function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${label}`);
  return readJsonArray(value);
}

export function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unexpected contract field');
}

export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Invalid ${label}`);
  return value;
}
