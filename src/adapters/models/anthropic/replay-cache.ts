import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { AssistantMessage, Message } from '../../../contracts/messages/message.js';
import type { ModelRequest } from '../../../contracts/models/gateway.js';
import { parseJsonValue } from '../../../contracts/messages/json.js';
import { createFingerprint } from '../../../shared/fingerprints/fingerprint.js';

/** What the engine persists of an assistant turn: content and tool calls, not provider blocks. */
export function assistantKey(request: ModelRequest, message: Pick<AssistantMessage, 'content' | 'toolCalls'>,
  prefix: readonly Message[] = request.messages): string {
  return createFingerprint({
    scope: { actorId: request.scope.actorId, appId: request.scope.appId, tenantId: request.scope.tenantId ?? null },
    conversationId: request.conversationId, runId: request.runId, model: request.model,
    tools: request.tools, responseSchema: request.responseSchema ?? null, prefix,
    content: message.content, toolCalls: message.toolCalls ?? [],
  }, { domain: 'viper.model.anthropic.assistant_turn', version: '2' });
}

/**
 * Provider-opaque replay data (thinking blocks with signatures, fallback markers) keyed by the
 * normalized assistant turn. Anthropic requires prior thinking blocks to be sent back unchanged
 * within a conversation; the engine's provider-neutral history cannot hold them, so the adapter
 * keeps them here. Bounded LRU in process memory: a miss only loses earlier reasoning, which the
 * API tolerates (`drop_block`), never correctness. A durable store can implement the same shape.
 */
export class AssistantReplayCache {
  private readonly entries = new Map<string, { readonly blocks: readonly BetaContentBlock[]; readonly bytes: number }>();
  private bytes = 0;

  constructor(private readonly capacity = 1_000, private readonly maxBytes = 16_777_216) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Invalid replay cache capacity');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Invalid replay cache byte limit');
  }

  get size(): number { return this.entries.size; }

  remember(key: string, blocks: readonly BetaContentBlock[]): void {
    const serialized = JSON.stringify(blocks);
    const bytes = new TextEncoder().encode(serialized).byteLength;
    this.bytes -= this.entries.get(key)?.bytes ?? 0;
    this.entries.delete(key);
    if (bytes > this.maxBytes) return;
    // SDK validates the provider wire shape; JSON cloning adds deep immutability to opaque blocks.
    // SDK adds non-enumerable parsed-output helpers; preserve only actual provider JSON fields.
    const snapshot = parseJsonValue(JSON.parse(serialized)) as unknown as readonly BetaContentBlock[];
    this.entries.set(key, Object.freeze({ blocks: snapshot, bytes }));
    this.bytes += bytes;
    while (this.entries.size > this.capacity || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.entries.get(oldest)?.bytes ?? 0;
      this.entries.delete(oldest);
    }
  }

  recall(key: string): readonly BetaContentBlock[] | undefined {
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry?.blocks;
  }
}
