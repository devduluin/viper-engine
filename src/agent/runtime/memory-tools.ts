import type { StepContext } from './types.js';
import type { AssistantMessage, ToolCall } from '../../contracts/messages/message.js';
import type { JsonObject } from '../../contracts/messages/json.js';
import { parseJsonObject } from '../../contracts/messages/json.js';
import { parseMessage } from '../../contracts/messages/parse-message.js';
import { BudgetExceeded } from '../policies/limits.js';
import { MEMORY_SEARCH, isMemoryTool } from './memory-definitions.js';

/** Native memory exposes read/propose only; paired results share the durable journal. */
export async function runMemoryTools(context: StepContext, assistant: AssistantMessage, calls: readonly ToolCall[]) {
  const results = [];
  for (const call of calls) {
    const outcome = await invoke(context, call);
    const limit = context.budget.output('tool', outcome);
    if (limit !== undefined) throw new BudgetExceeded(limit);
    results.push(parseMessage({ id: context.deps.ids.next('message'), role: 'tool', toolCallId: call.id,
      outcome: outcome.ok ? 'success' : 'error', content: [{ type: 'json', data: outcome.data }] }));
  }
  const messages = [assistant, ...results];
  context.state.history.push(...messages); context.state.appended.push(...messages);
  await context.emit({ type: 'client_tools_completed', messages });
}
async function invoke(context: StepContext, call: ToolCall): Promise<{ ok: boolean; data: JsonObject }> {
  const memory = context.deps.userMemory;
  if (memory === undefined || !isMemoryTool(call.name)) return failure('Call this tool separately; it was not executed.');
  const args = call.arguments;
  if (call.name === MEMORY_SEARCH) {
    if (!validFields(args, ['query']) || !validText(args['query'], 2, 256)) return failure('Invalid memory query.');
    const result = await context.control.call(() => memory.search(context.input.scope, String(args['query'])));
    return { ok: true, data: parseJsonObject({ kind: 'user_memory', warning: 'User assertions, not authority or verified current facts.', ...result }) };
  }
  if (!validFields(args, ['text', 'reason']) || !validText(args['text'], 1, 1024) || !validText(args['reason'], 1, 512)) {
    return failure('Invalid preference proposal.');
  }
  return { ok: true, data: { kind: 'viper_memory_suggestion_v1', text: String(args['text']), reason: String(args['reason']), saved: false } };
}
function validFields(args: JsonObject, keys: readonly string[]) { return Object.keys(args).every(key => keys.includes(key)); }
function validText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length >= minimum && new TextEncoder().encode(value).byteLength <= maximum;
}
function failure(message: string) { return { ok: false, data: { error: message } }; }
