import type { BetaMessage, BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { parseModelDecision } from '../../../contracts/models/decision.js';
import type { ModelDecision } from '../../../contracts/models/decision.js';
import type { ModelFailure, ModelFailureCode } from '../../../contracts/models/gateway.js';
import type { ModelUsage } from '../../../contracts/models/usage.js';
import { parseModelUsage } from '../../../contracts/models/usage.js';

export type Interpretation =
  | { readonly ok: true; readonly decision: ModelDecision }
  | { readonly ok: false; readonly error: ModelFailure };

function failed(code: ModelFailureCode, message: string): Interpretation {
  return { ok: false, error: Object.freeze({ code, message, retryable: false }) };
}

/** Billed input includes cache reads/writes; the engine reports one input figure. */
export function usageFrom(usage: BetaUsage): ModelUsage {
  const input = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return parseModelUsage({
    source: 'provider', inputTokens: input, outputTokens: usage.output_tokens, totalTokens: input + usage.output_tokens,
  });
}

function stopFailure(message: BetaMessage): Interpretation | undefined {
  switch (message.stop_reason) {
    case 'refusal': {
      return failed('permission', 'Model declined the request');
    }
    // A truncated turn may hold a partial tool input: never surface it as executable.
    case 'max_tokens': return failed('output_limit', 'Model output reached max_tokens');
    case 'model_context_window_exceeded': return failed('unsupported', 'Request exceeds the model context window');
    case 'pause_turn':
    case 'compaction': return failed('invalid_response', `Unexpected stop reason ${message.stop_reason}`);
    case 'end_turn':
    case 'tool_use':
    case 'stop_sequence': return undefined;
    default: return failed('invalid_response', 'Model response has no recognized completion reason');
  }
}

/**
 * Provider message → engine decision. Thinking, fallback and other provider blocks are not
 * part of the decision (the replay cache keeps them). Tool calls win over text: the text in the
 * same turn is kept as the decision's content.
 */
export function interpretMessage(message: BetaMessage): Interpretation {
  const stopped = stopFailure(message);
  if (stopped !== undefined) return stopped;
  const content = message.content.flatMap(block => (block.type === 'text' ? [{ type: 'text' as const, text: block.text }] : []));
  const calls = message.content.flatMap(block => (block.type === 'tool_use'
    ? [{ id: block.id, name: block.name, arguments: block.input }] : []));
  try {
    const decision = calls.length > 0
      ? parseModelDecision({ kind: 'tool_calls', calls, content })
      : parseModelDecision({ kind: 'final', content });
    return { ok: true, decision };
  } catch {
    return failed('invalid_response', calls.length > 0 ? 'Model returned an invalid tool call' : 'Model returned no usable content');
  }
}
