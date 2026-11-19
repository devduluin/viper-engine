import { parseMessage } from '../../contracts/messages/parse-message.js';
import type { AssistantMessage, ToolCall } from '../../contracts/messages/message.js';
import type { StepContext } from './types.js';
import { BudgetExceeded } from '../policies/limits.js';

export async function discoverTools(context: StepContext, assistant: AssistantMessage, call: ToolCall): Promise<void> {
  const discovery = context.discovery;
  if (!discovery.canSearch) throw new BudgetExceeded('tool_search_limit');
  const anchor = context.state.history.at(-1)?.id;
  if (anchor === undefined) throw new Error('Discovery requires canonical input');
  const output = discovery.search(call.arguments);
  const limit = context.budget.output('tool', output);
  if (limit !== undefined) throw new BudgetExceeded(limit);
  const result = parseMessage({ id: context.deps.ids.next('message'), role: 'tool', toolCallId: call.id, outcome: 'success',
    content: [{ type: 'text', text: JSON.stringify(output) }] });
  if (result.role !== 'tool') throw new Error('Invalid discovery result');
  try { discovery.record({ afterMessageId: anchor, assistant, result }); }
  catch (error) { if (error instanceof RangeError) throw new BudgetExceeded('context_input_limit'); throw error; }
  await context.emit({ type: 'tools_discovered', state: discovery.snapshot() });
}
