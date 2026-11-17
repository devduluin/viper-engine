import type { ApiCall } from '../../contracts/api/control.js';
import type { TrustedScope } from '../../contracts/identity/scope.js';
import { ApiFailure } from '../../contracts/api/failure.js';
import type { ApiOptions } from './options.js';
import { text, revision } from './input.js';

export async function createConnection(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  const serverId = text(call.body, 'serverId');
  const grant = await options.authorizeServer(scope, serverId);
  if (grant === false) throw new ApiFailure('NOT_FOUND');
  return options.database.transaction(stores => stores.control.createConnection(scope, serverId,
    options.ids.next('mcp_connection'), grant, options.clock.now()));
}

export async function listConnections(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  const after = call.cursor === undefined ? '' : options.cursors.read(scope, 'connections', 'connections', call.cursor);
  const limit = call.limit ?? 100;
  return options.database.snapshot(async stores => {
    const all = await stores.control.listConnections(scope, after, limit + 1); const items = all.slice(0, limit);
    const last = items.at(-1); const id = last?.['connectionId'];
    return { schemaVersion: 1, items, ...(all.length <= limit || typeof id !== 'string' ? {} : {
      nextCursor: options.cursors.issue(scope, 'connections', 'connections', id) }) };
  });
}

export async function disconnectConnection(scope: TrustedScope, call: ApiCall, options: ApiOptions) {
  if (call.resourceId === undefined) throw new ApiFailure('INVALID_REQUEST');
  return options.database.transaction(stores => stores.control.disconnectConnection(scope, call.resourceId!, revision(call.body), options.clock.now()));
}
