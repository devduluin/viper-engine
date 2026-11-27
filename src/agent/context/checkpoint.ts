import type { ContextBudget } from '../../contracts/context/budget.js';
import type { ContextCheckpoint } from '../../contracts/context/checkpoint.js';
import { prefixDigest, summarizedPrefix } from './summary.js';
import type { SummarySource } from './summary.js';
import { historyTurns } from './turns.js';

/** Validate before recovery can resume any approved tool, including when history has pending calls. */
export function assertContextCheckpoint(input: SummarySource, previous: ContextCheckpoint, budget: ContextBudget): void {
  if (previous.conversationId !== input.conversationId || previous.runId !== input.runId || previous.coveredMessages > input.history.messages.length) throw new Error('Context checkpoint scope mismatch');
  const turns = historyTurns(input.history.messages, previous.preserveFromMessageId);
  if (turns.some(turn => turn.protected && turn.start < previous.coveredMessages)) throw new Error('Context checkpoint covers protected work');
  if (previous.coveredMessages > 0 && !turns.some(turn => turn.start === previous.coveredMessages)) throw new Error('Context checkpoint splits a turn');
  const prefix = input.history.messages.slice(0, previous.coveredMessages);
  if (prefixDigest(input, prefix) !== previous.sourceDigest) throw new Error('Context checkpoint source changed');
  const excerpt = prefix.length === 0 ? '' : summarizedPrefix(input, prefix, budget.maxSummaryBytes, previous.version).excerpt;
  if (excerpt !== previous.excerpt) throw new Error('Context checkpoint excerpt changed');
}
