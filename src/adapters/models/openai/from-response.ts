import type { ChatCompletion } from 'openai/resources/chat/completions/completions';
import type { CompletionUsage } from 'openai/resources/completions';
import { parseModelDecision } from '../../../contracts/models/decision.js';
import type { ModelDecision } from '../../../contracts/models/decision.js';
import type { ModelFailure, ModelFailureCode } from '../../../contracts/models/gateway.js';
import type { ModelUsage } from '../../../contracts/models/usage.js';
import { parseModelUsage } from '../../../contracts/models/usage.js';

export type Interpretation =
  | { readonly ok: true; readonly decision: ModelDecision }
  | { readonly ok: false; readonly error: ModelFailure };

const failed = (code: ModelFailureCode, message: string): Interpretation =>
  ({ ok: false, error: Object.freeze({ code, message, retryable: false }) });

export function usageFrom(usage: CompletionUsage | null | undefined): ModelUsage {
  if (usage === null || usage === undefined) {
    return Object.freeze({ source: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null });
  }
  if (usage.prompt_tokens + usage.completion_tokens !== usage.total_tokens) throw new Error('Inconsistent model usage');
  // Automatic prefix caching reports reads only; writes are not reported, so that field stays absent.
  const cached = usage.prompt_tokens_details?.cached_tokens;
  return parseModelUsage({
    source: 'provider', inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, totalTokens: usage.total_tokens,
    ...(typeof cached === 'number' ? { cacheReadTokens: cached } : {}),
  });
}

function toolCalls(message: ChatCompletion.Choice['message']): unknown[] {
  return (message.tool_calls ?? []).map(call => {
    if (call.type !== 'function') throw new Error('Unsupported tool call type');
    return { id: call.id, name: call.function.name, arguments: JSON.parse(call.function.arguments) as unknown };
  });
}

/**
 * First choice → engine decision. `length` and content filtering are failures, so a truncated
 * tool call never becomes executable; malformed argument JSON is `invalid_response`.
 */
function stopped(choice: ChatCompletion.Choice): Interpretation | undefined {
  if (choice.finish_reason === 'length') return failed('output_limit', 'Model output reached max_completion_tokens');
  if (choice.finish_reason === 'content_filter') return failed('permission', 'Model output was blocked by the provider content filter');
  if (choice.finish_reason !== 'stop' && choice.finish_reason !== 'tool_calls') return failed('invalid_response', 'Model response has no recognized completion reason');
  if (choice.message.refusal !== null && choice.message.refusal !== undefined) return failed('permission', 'Model declined the request (refusal)');
  return undefined;
}

function toDecision(calls: { readonly name: string; readonly arguments: unknown }[], content: readonly { type: 'text'; text: string }[]): ModelDecision {
  return calls.length > 0
    ? parseModelDecision({ kind: 'tool_calls', calls, content })
    : parseModelDecision({ kind: 'final', content });
}

export function interpretCompletion(completion: ChatCompletion): Interpretation {
  const choice = completion.choices[0];
  if (choice === undefined || completion.choices.length !== 1) return failed('invalid_response', 'Model returned an unexpected number of choices');
  const failure = stopped(choice);
  if (failure !== undefined) return failure;
  const content = choice.message.content === null || choice.message.content.length === 0
    ? [] : [{ type: 'text' as const, text: choice.message.content }];
  try {
    const calls = toolCalls(choice.message) as { readonly name: string; readonly arguments: unknown }[];
    if ((calls.length > 0) !== (choice.finish_reason === 'tool_calls')) return failed('invalid_response', 'Model completion reason and tool calls disagree');
    return { ok: true, decision: toDecision(calls, content) };
  } catch {
    return failed('invalid_response', 'Model returned an invalid tool call or no usable content');
  }
}
