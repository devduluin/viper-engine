import type { Message } from '../../contracts/messages/message.js';

export interface HistoryTurn { readonly start: number; readonly end: number; readonly protected: boolean }
/** Only split at user turns outside a tool batch; interleaved parallel results remain together. */
export function historyTurns(messages: readonly Message[], preserveFrom: string): readonly HistoryTurn[] {
  const starts = [0]; const pending = new Set<string>();
  for (const [index, message] of messages.entries()) {
    if (index > 0 && message.role === 'user' && pending.size === 0) starts.push(index);
    if (message.role === 'assistant') for (const call of message.toolCalls ?? []) pending.add(call.id);
    if (message.role === 'tool') pending.delete(message.toolCallId);
  }
  const anchor = messages.findIndex(message => message.id === preserveFrom);
  if (anchor < 0) throw new Error('Context anchor missing from history');
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? messages.length;
    return { start, end, protected: end > anchor || messages.slice(start, end).some(message => message.role === 'tool' && message.outcome === 'unknown') };
  });
}
