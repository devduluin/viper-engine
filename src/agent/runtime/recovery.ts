import type { Message } from '../../contracts/messages/message.js';
import type { ModelFailure } from '../../contracts/models/gateway.js';
import { parseMessage } from '../../contracts/messages/parse-message.js';
import type { LoopState, StepContext } from './types.js';
import type { RunStopReason } from './types.js';

const MAX_OUTPUT_RETRIES = 2;
const MAX_INVALID_RETRIES = 1;
const MAX_BOOST = 4;

const OUTPUT_NOTICE = 'Your previous response was cut off because it exceeded the output token limit, so nothing of it was kept. '
  + 'Do not repeat it in one piece. Split the work: write large files in several smaller steps (create the file with the '
  + 'first part, then append or edit the next parts), keep tool arguments short, and summarize instead of quoting long text.';
const INVALID_NOTICE = 'Your previous response could not be used (it was malformed or incomplete, possibly cut off). '
  + 'Answer again with smaller, complete tool calls or a plain answer.';

/**
 * A recoverable model failure becomes another model step instead of a failed run, like a coding agent continuing
 * after a cut-off answer: a larger output allowance (bounded by the token budget) and a transient instruction that is
 * sent with the retry only, never stored as conversation history. Each retry is an ordinary charged model call.
 */
export function recoverModelFailure(state: LoopState, failure: ModelFailure | 'invalid'): boolean {
  const recovery = state.recovery ?? { outputRetries: 0, invalidRetries: 0, boost: 1 };
  if (failure === 'invalid') {
    if (recovery.invalidRetries >= MAX_INVALID_RETRIES) return false;
    state.recovery = { ...recovery, invalidRetries: recovery.invalidRetries + 1, notice: INVALID_NOTICE };
    return true;
  }
  if (failure.code !== 'output_limit' || recovery.outputRetries >= MAX_OUTPUT_RETRIES) return false;
  state.recovery = { ...recovery, outputRetries: recovery.outputRetries + 1, boost: Math.min(MAX_BOOST, recovery.boost * 2), notice: OUTPUT_NOTICE };
  return true;
}

/** A usable response ends the recovery episode (its counters are per episode, the model-call ceiling stays global). */
export function settleRecovery(state: LoopState): void {
  delete state.recovery;
}

/** Transient system instruction for the next model request only. */
export function recoveryInstructions(context: StepContext): readonly Message[] {
  const notice = context.state.recovery?.notice;
  return notice === undefined ? [] : [parseMessage({ id: context.deps.ids.next('message'), role: 'system', content: [{ type: 'text', text: notice }] })];
}

export function outputAllowance(context: StepContext): number {
  return context.input.maxOutputTokens * (context.state.recovery?.boost ?? 1);
}

const LIMIT_LABELS: Partial<Record<RunStopReason, string>> = {
  step_limit: 'jumlah langkah', tool_call_limit: 'jumlah panggilan tool', model_call_limit: 'jumlah panggilan model',
  token_limit: 'token', context_input_limit: 'ukuran konteks', repetition_limit: 'pengulangan tool yang sama',
  correction_limit: 'jumlah perbaikan', model_output_limit: 'ukuran output', tool_output_limit: 'ukuran output tool',
  total_output_limit: 'total output', tool_search_limit: 'pencarian tool',
};

function answered(history: readonly Message[]): boolean {
  const calls = history.flatMap(message => message.role === 'assistant' ? (message.toolCalls ?? []).map(call => call.id) : []);
  const results = new Set(history.flatMap(message => message.role === 'tool' ? [message.toolCallId] : []));
  return calls.every(id => results.has(id));
}

/**
 * A run that reaches a configured limit ends with an explanation and a way to continue, not a bare failure. Only when
 * every tool call is answered (the notice must not split a call from its result) and the reason is a known limit.
 */
export function limitNotice(context: StepContext, reason: RunStopReason): Message | undefined {
  const label = LIMIT_LABELS[reason];
  if (label === undefined || !answered(context.state.history)) return undefined;
  const text = `Pekerjaan dihentikan karena mencapai batas ${label} untuk mode ini. Hasil yang sudah diperoleh tetap tersimpan `
    + 'dan belum dipastikan selesai. Ketik **lanjut** untuk melanjutkan dari titik ini, atau pilih mode yang lebih mendalam.';
  return parseMessage({ id: context.deps.ids.next('message'), role: 'assistant', content: [{ type: 'text', text }] });
}
