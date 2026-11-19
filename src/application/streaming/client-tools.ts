import type { ClientToolCall, ClientToolOutcome } from '../../agent/runtime/types.js';
import { processDeltas, type DeltaBus } from './delta-bus.js';
import type { ClientToolRequestFrame } from './frames.js';
export type { ClientToolRequestFrame } from './frames.js';


interface Pending { readonly settle: (outcome: ClientToolOutcome) => void }

/**
 * Process-local rendezvous between a run waiting on a client tool and the client's reply
 * (POST /runs/{id}/client-results). The request is re-sent every `resendMs` until answered, so a
 * reconnecting stream still receives it. Unanswered requests resolve to an error outcome at the
 * deadline: the run continues and the model explains that the page could not be read.
 */
export class ClientToolBroker {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly bus: DeltaBus, private readonly now: () => number = Date.now, private readonly resendMs = 3000) {}

  request(call: ClientToolCall, timeoutMs: number, signal: AbortSignal): Promise<ClientToolOutcome> {
    const key = keyOf(call.runId, call.toolCallId);
    const frame: ClientToolRequestFrame = { schemaVersion: 1, type: 'client_tool.request', conversationId: call.conversationId,
      runId: call.runId, toolCallId: call.toolCallId, name: call.name, arguments: call.arguments, expiresAt: this.now() + timeoutMs };
    return new Promise<ClientToolOutcome>(resolve => {
      const finish = (outcome: ClientToolOutcome) => {
        if (!this.pending.has(key)) return;
        this.pending.delete(key); clearInterval(resend); clearTimeout(deadline); signal.removeEventListener('abort', aborted);
        resolve(outcome);
      };
      const aborted = () => finish({ outcome: 'error', message: 'The request was cancelled.' });
      this.pending.set(key, { settle: finish });
      const resend = setInterval(() => this.bus.publish(frame), this.resendMs);
      const deadline = setTimeout(() => finish({ outcome: 'error',
        message: 'The page could not be read: the Viper panel did not answer (closed, reloaded or not allowed on this page).' }), timeoutMs);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted(); else this.bus.publish(frame);
    });
  }

  /** Delivers the client's answer; false when nothing is waiting (already answered, timed out or another process). */
  reply(runId: string, toolCallId: string, outcome: ClientToolOutcome): boolean {
    const pending = this.pending.get(keyOf(runId, toolCallId));
    if (pending === undefined) return false;
    pending.settle(outcome);
    return true;
  }

  get waiting(): number { return this.pending.size; }
}

const keyOf = (runId: string, toolCallId: string) => `${runId}\u0000${toolCallId}`;

/** Same process as the SSE handler (viper-host runs API and worker together). */
export const processClientTools = new ClientToolBroker(processDeltas);
