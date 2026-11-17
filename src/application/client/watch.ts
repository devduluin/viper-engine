import type { EngineClientPort, ClientUpdate, WatchOptions } from '../../contracts/client/ports.js';
import { EngineClientFailure } from '../../contracts/client/failure.js';
import { WatchCheckpoint, snapshotCheckpoint, validateCheckpoint } from './checkpoint.js';
import { watchSettings, terminal, terminalEvent, recoverable, reconnectDelay } from './recovery.js';

/** Reconnects reads only. Consumers persist each checkpoint after applying its event. */
export async function* watchRun(client: EngineClientPort, runId: string, options: WatchOptions = {}): AsyncGenerator<ClientUpdate> {
  const settings = watchSettings(options); const read = options.signal === undefined ? {} : { signal: options.signal };
  const initial = await client.run(runId, read);
  if (options.checkpoint !== undefined) validateCheckpoint(options.checkpoint, runId, initial.lastEventSequence);
  const state = new WatchCheckpoint(options.checkpoint ?? snapshotCheckpoint(initial));
  if (options.checkpoint === undefined || terminal(initial.status) && initial.lastEventSequence === state.value.sequence) {
    yield { kind: 'snapshot', snapshot: initial, recovered: false }; if (terminal(initial.status)) return;
  }
  yield* reconnectWatch(client, state, options, settings);
}

async function* reconnectWatch(client: EngineClientPort, state: WatchCheckpoint, options: WatchOptions,
  settings: ReturnType<typeof watchSettings>): AsyncGenerator<ClientUpdate> {
  let attempts = 0; let ended = false;
  const read = options.signal === undefined ? {} : { signal: options.signal };
  for (;;) {
    try {
      if (!ended) { yield* follow(client, state, read); ended = true; }
      const snapshot = await client.run(state.value.runId, read);
      if (!terminal(snapshot.status)) throw new EngineClientFailure('INVALID_RESPONSE');
      yield { kind: 'snapshot', snapshot, recovered: false }; return;
    } catch (error) {
      const mode = recoverable(error); if (mode === undefined) throw error;
      if (attempts >= settings.retries) throw new EngineClientFailure('RECONNECT_LIMIT');
      if (mode === 'snapshot') {
        const snapshot = await client.run(state.value.runId, read);
        yield { kind: 'snapshot', snapshot, recovered: true }; state.value = snapshotCheckpoint(snapshot);
        if (terminal(snapshot.status)) return;
      }
      await reconnectDelay(attempts++, settings, options.signal);
    }
  }
}

async function* follow(client: EngineClientPort, state: WatchCheckpoint, read: { readonly signal?: AbortSignal }): AsyncGenerator<ClientUpdate> {
  for await (const item of client.events(state.value.runId, { ...read, cursor: state.value.cursor })) {
    const update = state.update(item); if (update === undefined) continue;
    yield update; state.accept(update);
    if (terminalEvent(item.event.type)) return;
  }
  throw new EngineClientFailure('STREAM_CLOSED');
}
