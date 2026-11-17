import { parseId } from '../contracts/identity/ids.js';
import { scopeFromAuthenticatedIdentity } from '../contracts/identity/scope.js';
import type { Message } from '../contracts/messages/message.js';
import { parseMessage } from '../contracts/messages/parse-message.js';
import type { ModelGateway, ModelRequest, ModelResult } from '../contracts/models/gateway.js';
import { createModelGateway, systemClock } from './model.js';
import { parseModelConfig } from './model-config.js';
import { createOpenAIModelGateway, parseOpenAIModelConfig } from './openai-model.js';

// `npm run model:smoke`: two live calls (tool call, then final answer from the tool result).
// VIPER_MODEL_PROVIDER selects anthropic (ANTHROPIC_API_KEY, VIPER_MODEL) or openai
// (OPENAI_API_KEY, VIPER_OPENAI_MODEL). Low effort, small limits; never prints a key.
function selectGateway(): { readonly gateway: ModelGateway; readonly model: string; readonly label: string } {
  if (process.env['VIPER_MODEL_PROVIDER']?.trim() === 'openai') {
    const openai = parseOpenAIModelConfig(process.env);
    return { gateway: createOpenAIModelGateway(openai, systemClock), model: openai.model, label: `openai ${openai.model}` };
  }
  const anthropic = parseModelConfig({ ...process.env, VIPER_MODEL_EFFORT: process.env['VIPER_MODEL_SMOKE_EFFORT'] ?? 'low' });
  return {
    gateway: createModelGateway(anthropic), model: anthropic.model,
    label: `anthropic ${anthropic.model}, effort ${anthropic.effort}, fallbacks ${anthropic.fallbacks}`,
  };
}

const { gateway, model, label } = selectGateway();
const scope = scopeFromAuthenticatedIdentity({ actorId: parseId('actor', 'smoke'), appId: parseId('app', 'smoke') });
const tool = {
  name: 'inv__lookup_item', description: 'Get the current stock count of an inventory item by exact ID.',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
};

function request(step: number, messages: readonly Message[]): ModelRequest {
  return {
    scope, conversationId: parseId('conversation', 'smoke-conversation'), runId: parseId('run', 'smoke-run'),
    stepId: parseId('step', `smoke-step-${step}`), modelCallId: parseId('model_call', `smoke-call-${step}`),
    model, maxOutputTokens: 4_000, messages, tools: [tool], deadlineAt: Date.now() + 120_000,
  };
}

function report(step: number, result: ModelResult): void {
  const usage = `usage in=${result.usage.inputTokens ?? '?'} out=${result.usage.outputTokens ?? '?'}`;
  if (!result.ok) {
    console.log(`step ${step}: FAILED ${result.error.code} - ${result.error.message} (${usage})`);
    return;
  }
  const { decision } = result;
  const detail = decision.kind === 'tool_calls'
    ? decision.calls.map(call => `${call.name}(${JSON.stringify(call.arguments)})`).join(', ')
    : decision.kind === 'final' ? JSON.stringify(decision.content).slice(0, 300) : decision.question;
  console.log(`step ${step}: ${decision.kind} ${detail} (${usage})`);
}

const history: Message[] = [
  parseMessage({ id: 's1', role: 'system', content: [{ type: 'text', text: 'Answer inventory questions only from tool results. Be brief.' }] }),
  parseMessage({ id: 'u1', role: 'user', content: [{ type: 'text', text: 'How many units of item-1 are in stock?' }] }),
];
console.log(label);
const first = await gateway.generate(request(1, history));
report(1, first);
if (first.ok && first.decision.kind === 'tool_calls') {
  const calls = first.decision.calls;
  history.push(parseMessage({ id: 'a1', role: 'assistant', content: first.decision.content, toolCalls: calls }));
  for (const [index, call] of calls.entries()) {
    history.push(parseMessage({
      id: `t${index}`, role: 'tool', toolCallId: call.id, outcome: 'success',
      content: [{ type: 'json', data: { id: 'item-1', stock: 5 } }],
    }));
  }
  const second = await gateway.generate(request(2, history));
  report(2, second);
  process.exitCode = second.ok && second.decision.kind === 'final' ? 0 : 1;
} else {
  process.exitCode = 1;
}
