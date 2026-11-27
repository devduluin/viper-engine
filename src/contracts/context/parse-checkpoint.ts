import { parseJsonObject } from '../messages/json.js';
import { parseId } from '../identity/ids.js';
import type { ContextCheckpoint, ContextReport } from './checkpoint.js';

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid context counter'); return value;
}
function report(value: unknown): ContextReport {
  const row = parseJsonObject(value);
  if (row['approximate'] !== true || row['excludesProviderFraming'] !== true || typeof row['hasUnpricedMedia'] !== 'boolean') throw new Error('Invalid context estimate');
  return { inputMessages: integer(row['inputMessages']), selectedMessages: integer(row['selectedMessages']), omittedMessages: integer(row['omittedMessages']),
    beforeTokens: integer(row['beforeTokens']), afterTokens: integer(row['afterTokens']), inputBytes: integer(row['inputBytes']),
    approximate: true, excludesProviderFraming: true, hasUnpricedMedia: row['hasUnpricedMedia'] };
}
export function parseContextCheckpoint(value: unknown): ContextCheckpoint {
  const row = parseJsonObject(value);
  if ((row['version'] !== 1 && row['version'] !== 2) || typeof row['sourceDigest'] !== 'string' || !/^[a-f0-9]{64}$/.test(row['sourceDigest'])) throw new Error('Invalid context checkpoint');
  if (typeof row['excerpt'] !== 'string' || new TextEncoder().encode(row['excerpt']).byteLength > 65536) throw new Error('Invalid context excerpt');
  return Object.freeze({ version: row['version'], conversationId: parseId('conversation', row['conversationId']), runId: parseId('run', row['runId']),
    preserveFromMessageId: parseId('message', row['preserveFromMessageId']), coveredMessages: integer(row['coveredMessages']),
    sourceDigest: row['sourceDigest'], excerpt: row['excerpt'], report: Object.freeze(report(row['report'])) });
}
