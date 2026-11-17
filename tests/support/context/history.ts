import { parseMessage } from '../../../src/contracts/messages/parse-message.js';
import type { Message } from '../../../src/contracts/messages/message.js';
import { testContext } from '../agent/setup.js';

export const policy = { windowTokens: 12000, framingReserveTokens: 128, maxInputBytes: 6000, maxSummaryBytes: 1024, recentTurns: 1 };
export const user = (id: string, text: string) => parseMessage({ id, role: 'user', content: [{ type: 'text', text }] });
export const assistant = (id: string, text: string) => parseMessage({ id, role: 'assistant', content: [{ type: 'text', text }] });
export function oldHistory(count = 8, length = 3000): Message[] {
  return Array.from({ length: count }, (_, index) => [user(`old-user-${index}`, `Original request ${index}: ${'old context '.repeat(length / 12)}`),
    assistant(`old-answer-${index}`, `Unverified generated answer ${index}: ${'historical text '.repeat(length / 16)}`)]).flat();
}
export function contextInput(messages: readonly Message[] = [...oldHistory(), user('active-user', 'Current task')]) {
  const input = testContext(); return { ...input, history: { ...input.history, messages } };
}
export function pair(prefix: string, outcome: 'success' | 'error' | 'unknown' = 'success'): Message[] {
  return [user(`${prefix}-user`, 'Perform reads'), parseMessage({ id: `${prefix}-proposal`, role: 'assistant', content: [], toolCalls: [
    { id: `${prefix}-call-a`, name: 'read', arguments: { id: 'a' } }, { id: `${prefix}-call-b`, name: 'read', arguments: { id: 'b' } },
  ] }), parseMessage({ id: `${prefix}-b`, role: 'tool', toolCallId: `${prefix}-call-b`, outcome, content: [] }),
  parseMessage({ id: `${prefix}-a`, role: 'tool', toolCallId: `${prefix}-call-a`, outcome: 'success', content: [] })];
}
