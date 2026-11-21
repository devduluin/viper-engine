import type { ToolCallId } from '../../contracts/identity/ids.js';
import { parseId } from '../../contracts/identity/ids.js';
import { parseJsonObject } from '../../contracts/messages/json.js';

export interface BudgetState {
  readonly chargedTokens?: number;
  readonly steps: number; readonly toolCalls: number; readonly corrections: number;
  readonly modelOutputBytes: number; readonly toolOutputBytes: number;
  readonly repeated: readonly (readonly [string, number])[];
  readonly calls: readonly (readonly [ToolCallId, string])[];
  readonly uncertain: readonly string[];
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid budget count');
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid budget fingerprint');
  return value;
}

function entries(value: unknown): readonly (readonly unknown[])[] {
  if (!Array.isArray(value) || value.length > 10000 || value.some(entry => !Array.isArray(entry) || entry.length !== 2)) throw new Error('Invalid budget entries');
  return value;
}

export function parseBudgetState(value: unknown): BudgetState {
  const input = parseJsonObject(value);
  if (!Array.isArray(input['uncertain'])) throw new Error('Invalid uncertain calls');
  return Object.freeze({ steps: count(input['steps']), toolCalls: count(input['toolCalls']), corrections: count(input['corrections']),
    ...(input['chargedTokens'] === undefined ? {} : { chargedTokens: count(input['chargedTokens']) }),
    modelOutputBytes: count(input['modelOutputBytes']), toolOutputBytes: count(input['toolOutputBytes']),
    repeated: Object.freeze(entries(input['repeated']).map(([key, number]) => Object.freeze([hash(key), count(number)] as const))),
    calls: Object.freeze(entries(input['calls']).map(([id, key]) => Object.freeze([parseId('tool_call', id), hash(key)] as const))),
    uncertain: Object.freeze(input['uncertain'].map(hash)),
  });
}
