import type { ContextBudget } from '../../contracts/context/budget.js';
import { resolveContextBudget } from '../../contracts/context/budget.js';
import type { ContextCheckpoint } from '../../contracts/context/checkpoint.js';
import type { Message, ContextMessage } from '../../contracts/messages/message.js';
import type { MessageId } from '../../contracts/identity/ids.js';
import type { ModelCapabilities, ModelRequest } from '../../contracts/models/gateway.js';
import { BudgetExceeded } from '../policies/limits.js';
import { assembleContext } from './assemble.js';
import type { ContextInput } from './assemble.js';
import { estimateContextText } from './estimate.js';
import { historyTurns } from './turns.js';
import { prefixDigest, summarizedPrefix } from './summary.js';
import { assertContextCheckpoint } from './checkpoint.js';
import { assertMessageHistory } from '../../contracts/messages/history.js';

interface Selection { readonly request: ModelRequest; readonly covered: number; readonly digest: string; readonly excerpt: string }
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function fits(request: ModelRequest, budget: ContextBudget): boolean {
  return bytes(request) <= budget.maxInputBytes && estimateContextText(request).tokens + request.maxOutputTokens + budget.framingReserveTokens <= budget.windowTokens;
}
function anchor(input: ContextInput, previous?: ContextCheckpoint, start?: MessageId): MessageId {
  const lastUser = [...input.history.messages].reverse().find((message): message is ContextMessage => message.role === 'user');
  const id = start ?? previous?.preserveFromMessageId ?? lastUser?.id ?? input.history.messages[0]?.id;
  if (id === undefined) throw new Error('Context history is empty');
  if (!input.history.messages.some(message => message.id === id)) throw new Error('Context anchor missing from history'); return id;
}
function candidate(input: ContextInput, full: ModelRequest, covered: number, budget: ContextBudget): Selection {
  const prefix = input.history.messages.slice(0, covered);
  const summary = summarizedPrefix(input, prefix, budget.maxSummaryBytes);
  const instructions = full.messages.length - input.history.messages.length;
  const messages: readonly Message[] = Object.freeze([...full.messages.slice(0, instructions), summary.message, ...full.messages.slice(instructions + covered)]);
  assertMessageHistory(messages, { allowPendingToolCalls: false });
  return { request: { ...full, messages }, covered, digest: summary.digest, excerpt: summary.excerpt };
}
function select(input: ContextInput, full: ModelRequest, preserve: MessageId, budget: ContextBudget): Selection {
  if (fits(full, budget)) return { request: full, covered: 0, digest: prefixDigest(input, []), excerpt: '' };
  const turns = historyTurns(input.history.messages, preserve);
  const protectedIndex = turns.findIndex(turn => turn.protected);
  const maximum = Math.min(protectedIndex, Math.max(0, turns.length - budget.recentTurns));
  if (maximum < 1) throw new BudgetExceeded('context_input_limit');
  let best = candidate(input, full, turns[maximum]!.start, budget);
  if (!fits(best.request, budget)) throw new BudgetExceeded('context_input_limit');
  let low = 1; let high = maximum - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2); const next = candidate(input, full, turns[middle]!.start, budget);
    if (fits(next.request, budget)) { best = next; high = middle - 1; } else low = middle + 1;
  }
  return best;
}
/** Recency-first complete turns. Canonical history/ledger are never edited or replaced. */
export function prepareContext(input: ContextInput, capabilities: ModelCapabilities, now: number, options: Partial<ContextBudget>,
  previous?: ContextCheckpoint, start?: MessageId) {
  const budget = resolveContextBudget(options); const full = assembleContext(input, capabilities, now);
  if (previous !== undefined) assertContextCheckpoint(input, previous, budget);
  const preserve = anchor(input, previous, start); const selected = select(input, full.request, preserve, budget);
  const request = Object.freeze({ ...selected.request });
  const estimate = estimateContextText(request);
  const checkpoint: ContextCheckpoint = Object.freeze({ version: 1, conversationId: input.conversationId, runId: input.runId,
    preserveFromMessageId: preserve, coveredMessages: selected.covered, sourceDigest: selected.digest, excerpt: selected.excerpt,
    report: Object.freeze({ inputMessages: full.request.messages.length, selectedMessages: request.messages.length, omittedMessages: selected.covered,
      beforeTokens: full.estimate.tokens, afterTokens: estimate.tokens, inputBytes: bytes(request), approximate: true,
      hasUnpricedMedia: estimate.hasUnpricedMedia, excludesProviderFraming: true }) });
  return { request, estimate, checkpoint };
}
