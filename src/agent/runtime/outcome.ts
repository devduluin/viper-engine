import type { ToolCallReport } from '../execution/dispatch.js';
import type { RunStop } from './types.js';

/**
 * Terminal status of a final answer from dispatched-call evidence, never from the answer text.
 * - any `unknown` outcome: `partial` (the run cannot claim completion; reconciliation is needed);
 * - failures alongside successes: `partial`;
 * - only failures: `failed`, even if the model wrote a fluent final answer;
 * - otherwise `completed`. Calls rejected before dispatch carry no side-effect evidence.
 */
export function finalAnswerStop(reports: readonly ToolCallReport[]): RunStop {
  const count = (status: ToolCallReport['status']) => reports.filter(report => report.status === status).length;
  const succeeded = count('succeeded');
  const failed = count('failed');
  if (count('unknown') > 0) return { status: 'partial', reason: 'unknown_outcome' };
  if (failed > 0) return { status: succeeded > 0 ? 'partial' : 'failed', reason: 'tool_failures' };
  return { status: 'completed', reason: 'final_answer' };
}
