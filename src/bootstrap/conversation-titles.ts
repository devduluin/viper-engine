import { randomUUID } from 'node:crypto';
import { parseId } from '../contracts/identity/ids.js';
import type { TrustedScope } from '../contracts/identity/scope.js';
import { parseMessage } from '../contracts/messages/parse-message.js';
import type { EngineModel } from './configured-model.js';

const INSTRUCTION = 'Buat judul singkat (2 sampai 6 kata) untuk percakapan ini, dalam bahasa yang dipakai pengguna. '
  + 'Sebut subjek utamanya (nama orang, topik, periode) bila ada. Jawab hanya judulnya: tanpa tanda kutip, tanpa titik, tanpa penjelasan.';

/**
 * EngineHttpOptions.titleConversation backed by the configured model: one small call per conversation,
 * no tools. Not recorded as a run model call (it is not part of a run). Returns the raw text; the API cleans it.
 */
export function createModelTitler(model: EngineModel) {
  return async (scope: TrustedScope, exchange: { readonly question: string; readonly answer: string }): Promise<string> => {
    const uid = randomUUID();
    const result = await model.gateway.generate({
      scope, conversationId: parseId('conversation', `conversation-title-${uid}`), runId: parseId('run', `run-title-${uid}`),
      stepId: parseId('step', `step-title-${uid}`), modelCallId: parseId('model_call', `model_call-title-${uid}`),
      model: model.model, maxOutputTokens: 1024, tools: [],
      messages: [
        parseMessage({ id: `message-s-${uid}`, role: 'system', content: [{ type: 'text', text: INSTRUCTION }] }),
        parseMessage({ id: `message-u-${uid}`, role: 'user', content: [{ type: 'text',
          text: `Pertanyaan pengguna:\n${exchange.question.slice(0, 1500)}\n\nJawaban asisten:\n${exchange.answer.slice(0, 1500) || '(belum ada)'}` }] }),
      ],
    });
    if (!result.ok || result.decision.kind !== 'final') throw new Error('Title generation failed');
    return result.decision.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join(' ');
  };
}
