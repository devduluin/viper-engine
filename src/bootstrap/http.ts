import { randomUUID } from 'node:crypto';
import type { SqlPool } from '../adapters/persistence/postgres/sql-client.js';
import { SignedApiCursors } from '../adapters/http/cursors.js';
import { EngineApi } from '../application/api/service.js';
import type { ApiOptions } from '../application/api/options.js';
import { createHttpServer } from '../entrypoints/http/server.js';
import { assertSchemaReady } from './database.js';
import type { HttpOptions } from '../entrypoints/http/server.js';
import { parseId } from '../contracts/identity/ids.js';
import { apiDatabase } from './api-database.js';
import { withDeadline } from '../shared/async/deadline.js';
import { loadRunInstructions } from '../adapters/persistence/postgres/api-control.js';
import type { TrustedScope } from '../contracts/identity/scope.js';
import type { RunCheckpoint } from '../contracts/state/checkpoints.js';
import { eventReplay } from './event-replay.js';
import type { EventStreamOptions } from './event-replay.js';
import { createUserMemory } from './user-memory.js';

export interface EngineHttpOptions extends Pick<ApiOptions, 'authorizeServer' | 'prepareContext' | 'authorizeMedia' | 'titleConversation'> {
  readonly userMemory?: boolean;
  readonly authenticate: HttpOptions['authenticate'];
  /** Stable deployment secret, separate from bearer/provider credentials. */
  readonly cursorSecret: Uint8Array;
  readonly clock?: ApiOptions['clock']; readonly ids?: ApiOptions['ids'];
  readonly requestBytes?: number; readonly eventBytes?: number;
  readonly idempotencyRetentionSeconds?: number; readonly eventRetentionSeconds?: number;
  readonly stream?: EventStreamOptions | false;
  /** Check on `ready()`/`listen()` that the database is migrated for this build (default true). */
  readonly schemaCheck?: boolean;
  /** Host routes served without a bearer token (exact paths); see HttpOptions.publicRoutes. */
  readonly publicRoutes?: readonly string[];
}

export function createEngineHttpServer(pool: SqlPool, options: EngineHttpOptions) {
  options = Object.freeze({ ...options });
  const clock = options.clock ?? { now: () => Date.now() };
  const ids = options.ids ?? { next: <K extends string>(kind: K) => parseId(kind, `${kind}-${randomUUID()}`) };
  const requestBytes = bounded(options.requestBytes ?? 262144, 1048576);
  const eventBytes = bounded(options.eventBytes ?? 262144, 1048576);
  const idempotencyRetentionSeconds = bounded(options.idempotencyRetentionSeconds ?? 86400, 31536000);
  const eventRetentionSeconds = bounded(options.eventRetentionSeconds ?? 86400, 31536000);
  const cursors = new SignedApiCursors(options.cursorSecret, clock, eventRetentionSeconds * 1000);
  const api = new EngineApi({ database: apiDatabase(pool), clock, ids, requestBytes, eventBytes,
    idempotencyRetentionSeconds, eventRetentionSeconds,
    cursors, eventReplay: options.stream !== false,
    authorizeServer: (scope, id) => withDeadline(() => options.authorizeServer(scope, id), { operationName: 'server authorization', timeoutMs: 10000 }),
    ...optionalHooks(options),
  });
  const app = createHttpServer(api, { requestBytes,
    ...(options.publicRoutes === undefined ? {} : { publicRoutes: options.publicRoutes }),
    ...(options.userMemory ? { userMemory: createUserMemory(pool) } : {}),
    ...(options.stream === false ? {} : { replay: eventReplay(pool, cursors, clock, eventBytes, eventRetentionSeconds, options.stream) }),
    authenticate: token => withDeadline(() => options.authenticate(token),
    { operationName: 'HTTP authentication', timeoutMs: 10000 }) });
  // listen()/ready() reject with SchemaNotReadyError instead of serving 500s from an unmigrated database.
  app.addHook('onReady', async () => {
    if (options.schemaCheck !== false) await assertSchemaReady(pool);
  });
  return app;
}

/** Pass as ViperEngineOptions.instructions when pairing this HTTP surface with a worker. */
export function persistedRunInstructions(pool: SqlPool) {
  return (scope: TrustedScope, checkpoint: RunCheckpoint) => loadRunInstructions(pool, scope, checkpoint.run.id);
}

function bounded(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Invalid HTTP bound');
  return value;
}

/** Host hooks the API only uses when provided (context preparation, media authorization, titles). */
function optionalHooks(options: EngineHttpOptions): Partial<Pick<EngineHttpOptions, 'prepareContext' | 'authorizeMedia' | 'titleConversation'>> {
  return {
    ...(options.prepareContext === undefined ? {} : { prepareContext: options.prepareContext }),
    ...(options.authorizeMedia === undefined ? {} : { authorizeMedia: options.authorizeMedia }),
    ...(options.titleConversation === undefined ? {} : { titleConversation: options.titleConversation }),
  };
}
