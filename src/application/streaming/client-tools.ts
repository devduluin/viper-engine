import type { ClientToolCall, ClientToolOutcome } from '../../agent/runtime/types.js';
import { processDeltas, type DeltaBus } from './delta-bus.js';
import type { ClientToolRequestFrame } from './frames.js';
export type { ClientToolRequestFrame } from './frames.js';

/**
 * One line per client tool request (and per reply that found nothing waiting), for operations logs.
 * Never carries the tool's data or messages: only ids, the result kind, the client's reason code and sizes.
 *
 * - success / error: the client answered (error = it could not run the tool; `code` says why);
 * - timeout: no answer before the deadline; cancelled: the run was cancelled while waiting;
 * - late: an answer after timeout/cancel; duplicate: a second answer to an answered request;
 * - unmatched: an answer to a request this process never had (wrong replica, restart, or a bogus id).
 */
export interface ClientToolRecord {
  readonly name: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly result: 'success' | 'error' | 'timeout' | 'cancelled' | 'late' | 'duplicate' | 'unmatched';
  readonly code?: string;
  /** From the request to its end (or to the late answer). Absent for unmatched answers. */
  readonly durationMs?: number;
  /** Size of the client's answer (JSON), when there was one. */
  readonly bytes?: number;
}

export type ClientToolObserver = (record: ClientToolRecord) => void;

/** Reason code for an error answer, as sent by the client (validated again here). */
export interface ClientReplyMeta { readonly code?: string }

interface Pending { readonly name: string; readonly started: number; readonly settle: (outcome: ClientToolOutcome, record: Omit<ClientToolRecord, 'name' | 'runId' | 'toolCallId'>) => void }
interface Finished { readonly name: string; readonly started: number; readonly state: 'answered' | 'expired' }

const CODE = /^[a-z_]{1,32}$/;
/** Recently finished requests remembered to tell late and duplicate answers from unmatched ones. */
const RECENT_LIMIT = 512;

/**
 * Process-local rendezvous between a run waiting on a client tool and the client's reply
 * (POST /runs/{id}/client-results). The request is re-sent every `resendMs` until answered, so a
 * reconnecting stream still receives it. Unanswered requests resolve to an error outcome at the
 * deadline: the run continues and the model explains that the page could not be read.
 */
export class ClientToolBroker {
  private readonly pending = new Map<string, Pending>();
  private readonly recent = new Map<string, Finished>();
  private readonly observers = new Set<ClientToolObserver>();

  constructor(private readonly bus: DeltaBus, private readonly now: () => number = Date.now, private readonly resendMs = 3000) {}

  /** Adds a log/metrics observer; returns its removal. Observer failures never affect the run. */
  observe(observer: ClientToolObserver): () => void {
    this.observers.add(observer);
    return () => { this.observers.delete(observer); };
  }

  request(call: ClientToolCall, timeoutMs: number, signal: AbortSignal): Promise<ClientToolOutcome> {
    const key = keyOf(call.runId, call.toolCallId);
    const started = this.now();
    const frame: ClientToolRequestFrame = { schemaVersion: 1, type: 'client_tool.request', conversationId: call.conversationId,
      runId: call.runId, toolCallId: call.toolCallId, name: call.name, arguments: call.arguments, expiresAt: started + timeoutMs };
    return new Promise<ClientToolOutcome>(resolve => {
      const finish: Pending['settle'] = (outcome, record) => {
        if (!this.pending.has(key)) return;
        this.pending.delete(key); clearInterval(resend); clearTimeout(deadline); signal.removeEventListener('abort', aborted);
        this.remember(key, { name: call.name, started, state: record.result === 'success' || record.result === 'error' ? 'answered' : 'expired' });
        this.emit({ name: call.name, runId: call.runId, toolCallId: call.toolCallId, ...record });
        resolve(outcome);
      };
      const elapsed = () => this.now() - started;
      const aborted = () => finish({ outcome: 'error', message: 'The request was cancelled.' }, { result: 'cancelled', durationMs: elapsed() });
      this.pending.set(key, { name: call.name, started, settle: finish });
      const resend = setInterval(() => this.bus.publish(frame), this.resendMs);
      const deadline = setTimeout(() => finish({ outcome: 'error',
        message: 'The page could not be read: the Viper panel did not answer (closed, reloaded or not allowed on this page).' },
      { result: 'timeout', durationMs: elapsed() }), timeoutMs);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted(); else this.bus.publish(frame);
    });
  }

  /** Delivers the client's answer; false when nothing is waiting (already answered, timed out or another process). */
  reply(runId: string, toolCallId: string, outcome: ClientToolOutcome, meta: ClientReplyMeta = {}): boolean {
    const key = keyOf(runId, toolCallId);
    const bytes = sizeOf(outcome);
    const code = outcome.outcome === 'error' && meta.code !== undefined && CODE.test(meta.code) ? meta.code : undefined;
    const extra = code === undefined ? {} : { code };
    const pending = this.pending.get(key);
    if (pending !== undefined) {
      pending.settle(outcome, { result: outcome.outcome, ...extra, durationMs: this.now() - pending.started, bytes });
      return true;
    }
    const finished = this.recent.get(key);
    this.emit(finished === undefined
      ? { name: 'unknown', runId, toolCallId, result: 'unmatched', ...extra, bytes }
      : { name: finished.name, runId, toolCallId, result: finished.state === 'answered' ? 'duplicate' : 'late', ...extra,
        durationMs: this.now() - finished.started, bytes });
    return false;
  }

  get waiting(): number { return this.pending.size; }

  private remember(key: string, finished: Finished): void {
    this.recent.delete(key);
    this.recent.set(key, finished);
    if (this.recent.size > RECENT_LIMIT) this.recent.delete(this.recent.keys().next().value as string);
  }

  private emit(record: ClientToolRecord): void {
    for (const observer of this.observers) {
      try { observer(record); } catch { /* logging must never break a run */ }
    }
  }
}

const keyOf = (runId: string, toolCallId: string) => `${runId}\u0000${toolCallId}`;

function sizeOf(outcome: ClientToolOutcome): number {
  try { return Buffer.byteLength(JSON.stringify(outcome)); } catch { return 0; }
}

/** Same process as the SSE handler (viper-host runs API and worker together). */
export const processClientTools = new ClientToolBroker(processDeltas);
