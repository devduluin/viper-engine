import type { TrustedScope } from '../../contracts/identity/scope.js';
import type { RunCheckpoint } from '../../contracts/state/checkpoints.js';
import type { Message } from '../../contracts/messages/message.js';
import { parseMessage } from '../../contracts/messages/parse-message.js';
import { createFingerprint } from '../../shared/fingerprints/fingerprint.js';
import type { ViperEngineOptions } from '../engine-types.js';

/** Existing hosts may already load saved context; identical IDs dedup, conflicting content fails. */
export function workerInstructions(configured: ViperEngineOptions['instructions'],
  saved: (scope: TrustedScope, cp: RunCheckpoint) => Promise<readonly Message[]>) {
  return async (scope: TrustedScope, cp: RunCheckpoint): Promise<readonly Message[]> => {
    const base = typeof configured === 'function' ? await configured(scope, cp) : configured ?? [];
    const messages = base.map(parseMessage);
    const loaded = await saved(scope, cp);
    const unique = new Map<string, Message>();
    for (const message of [...messages, ...loaded.map(parseMessage)]) {
      const before = unique.get(message.id);
      if (before !== undefined && fingerprint(before) !== fingerprint(message)) throw new Error('Conflicting instruction identity');
      unique.set(message.id, message);
    }
    return [...unique.values()];
  };
}

function fingerprint(message: Message) {
  return createFingerprint(message, { domain: 'worker.instructions', version: '1' });
}
