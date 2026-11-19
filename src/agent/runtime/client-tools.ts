import { parseMessage } from '../../contracts/messages/parse-message.js';
import type { AssistantMessage, Message, ToolCall } from '../../contracts/messages/message.js';
import type { ModelToolDefinition } from '../../contracts/models/gateway.js';
import { BudgetExceeded } from '../policies/limits.js';
import type { ClientToolOutcome, StepContext } from './types.js';

/** Model-facing names of client tools carry this prefix, so they never collide with MCP namespaces. */
export const CLIENT_TOOL_PREFIX = 'client__';

const definitionsByLoop = new WeakMap<StepContext, Promise<readonly ModelToolDefinition[]>>();

/** Client tools this run offers (looked up once per loop invocation; none without a port). */
export function clientToolDefinitions(context: StepContext): Promise<readonly ModelToolDefinition[]> {
  const port = context.deps.clientTools;
  if (port === undefined) return Promise.resolve([]);
  let cached = definitionsByLoop.get(context);
  if (cached === undefined) {
    cached = port.definitions(context.input.runId).catch(() => []);
    definitionsByLoop.set(context, cached);
  }
  return cached;
}

export function isClientToolName(name: string): boolean {
  return name.startsWith(CLIENT_TOOL_PREFIX);
}

/**
 * Executes a model step that called client tools (e.g. reading the page in the user's browser).
 * They run outside MCP dispatch: no tool proposals or approvals, the assistant message and its results
 * are journaled together by `client_tools_completed`. Other calls in the same step are answered with an
 * error result (never dispatched), so the conversation stays valid and the model can call them again.
 */
export async function runClientTools(context: StepContext, assistant: AssistantMessage, calls: readonly ToolCall[]): Promise<void> {
  const offered = new Set((await clientToolDefinitions(context)).map(definition => definition.name));
  const results: Message[] = [];
  for (const call of calls) results.push(toolResult(context, call, await outcomeFor(context, call, offered)));
  const messages = [assistant, ...results];
  for (const message of messages) { context.state.history.push(message); context.state.appended.push(message); }
  await context.emit({ type: 'client_tools_completed', messages });
}

async function outcomeFor(context: StepContext, call: ToolCall, offered: ReadonlySet<string>): Promise<ClientToolOutcome> {
  const port = context.deps.clientTools;
  if (!isClientToolName(call.name)) {
    return { outcome: 'error', message: 'Not run: call this tool in a separate step, not together with a client tool.' };
  }
  if (port === undefined || !offered.has(call.name)) return { outcome: 'error', message: 'This tool is not available in this conversation.' };
  const { input } = context;
  const outcome = await context.control.call(signal => port.invoke({ scope: input.scope, conversationId: input.conversationId,
    runId: input.runId, toolCallId: call.id, name: call.name.slice(CLIENT_TOOL_PREFIX.length), arguments: call.arguments }, signal));
  const limit = context.budget.output('tool', outcome);
  if (limit !== undefined) throw new BudgetExceeded(limit);
  return outcome;
}

function toolResult(context: StepContext, call: ToolCall, outcome: ClientToolOutcome): Message {
  const message = parseMessage({ id: context.deps.ids.next('message'), role: 'tool', toolCallId: call.id,
    outcome: outcome.outcome === 'success' ? 'success' : 'error',
    content: outcome.outcome === 'success' ? [{ type: 'json', data: outcome.data }] : [{ type: 'text', text: outcome.message }] });
  if (message.role !== 'tool') throw new Error('Invalid client tool result');
  return message;
}
