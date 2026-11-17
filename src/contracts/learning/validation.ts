import { parseId } from '../identity/ids.js';
import { parseJsonObject } from '../messages/json.js';
import { noteSource } from '../recall/validation.js';
import { parseRevision } from '../state/result.js';
import type { FeedbackInput, ProposalInput, ProposalReview } from './ports.js';

function closed(value: unknown, keys: readonly string[]) {
  const input = parseJsonObject(value);
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error('Unexpected learning input field');
  return input;
}
export function candidateText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || new TextEncoder().encode(value).byteLength > 8192) throw new Error('Candidate must contain 1..8192 UTF8 bytes');
  if (/\u0000|[\uD800-\uDFFF]/u.test(value)) throw new Error('Candidate must contain valid PostgreSQL Unicode text');
  return value;
}
export function learningDigest(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('Expected SHA256 proposal digest');
  return value;
}
export function feedbackInput(value: FeedbackInput): FeedbackInput {
  const input = closed(value, ['runId', 'expectedRevision', 'verdict', 'source']);
  const revision = input['expectedRevision'];
  if (revision !== 0) parseRevision(revision);
  const verdict = input['verdict']; if (verdict !== 'confirmed' && verdict !== 'disputed') throw new Error('Invalid feedback verdict');
  return Object.freeze({ runId: parseId('run', input['runId']), expectedRevision: revision as number, verdict, source: sourceOf(input['source']) });
}
function sourceOf(value: unknown) {
  const source = closed(value, ['conversationId', 'messageId']);
  return noteSource({ conversationId: parseId('conversation', source['conversationId']), messageId: parseId('message', source['messageId']) });
}
export function proposalInput(value: ProposalInput): ProposalInput {
  const input = closed(value, ['runId', 'feedbackRevision', 'text']);
  return Object.freeze({ runId: parseId('run', input['runId']), feedbackRevision: parseRevision(input['feedbackRevision']), text: candidateText(input['text']) });
}
export function proposalReview(value: ProposalReview): ProposalReview {
  const input = closed(value, ['expectedRevision', 'digest', 'decision', 'confirmation']);
  const decision = input['decision']; if (decision !== 'accept' && decision !== 'reject') throw new Error('Invalid proposal decision');
  if ((decision === 'accept') !== (input['confirmation'] !== undefined)) throw new Error('Only acceptance requires confirmation');
  return Object.freeze({ expectedRevision: parseRevision(input['expectedRevision']), digest: learningDigest(input['digest']), decision,
    ...(input['confirmation'] === undefined ? {} : { confirmation: sourceOf(input['confirmation']) }) });
}
