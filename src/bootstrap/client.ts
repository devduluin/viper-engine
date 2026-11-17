import { EngineHttpClient } from '../adapters/http-client/client.js';
import { ClientCodec } from '../adapters/http-client/codec.js';
import { ClientTransport } from '../adapters/http-client/transport.js';
import { clientSettings } from '../adapters/http-client/options.js';
import type { EngineClientOptions } from '../adapters/http-client/options.js';
import type { EngineClientPort, ClientUpdate, WatchOptions } from '../contracts/client/ports.js';
import { watchRun } from '../application/client/watch.js';

export type { EngineClientOptions } from '../adapters/http-client/options.js';
export interface EngineClient extends EngineClientPort {
  watch(runId: string, options?: WatchOptions): AsyncIterable<ClientUpdate>;
}
export function createEngineClient(options: EngineClientOptions): EngineClient {
  const client = new EngineHttpClient(new ClientTransport(clientSettings(options), new ClientCodec()));
  return Object.assign(client, { watch: (runId: string, read?: WatchOptions) => watchRun(client, runId, read) });
}
