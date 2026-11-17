import type { Clock } from '../../../contracts/identity/ports.js';
import type { McpContext } from '../../../contracts/mcp/identity.js';
import { assertMcpContext } from '../../../contracts/mcp/identity.js';
import { McpToolCatalog } from './catalog.js';
import { SdkMcpGateway } from './gateway.js';
import { McpSession } from './session.js';
import type { McpSessionOptions } from './session.js';
import type { McpTransportConfig } from './transport.js';
import { snapshotContext } from './snapshot.js';
import { assertTimerDuration } from '../../../shared/async/delay.js';

export interface McpConnectOptions extends McpSessionOptions {
  readonly authorize?: () => Promise<void>;
  readonly clock: Clock;
  readonly requestTimeoutMs: number;
  readonly maxCatalogPages?: number;
}

export interface McpConnection {
  readonly gateway: SdkMcpGateway;
  readonly catalog: McpToolCatalog;
  readonly session: McpSession;
  /** Closes the client; for stdio this also terminates the server subprocess. */
  close(): Promise<void>;
}

/** Composition helper for bootstrap: one session, its catalog and an owner-bound gateway. */
export async function connectMcp(owner: McpContext, config: McpTransportConfig, options: McpConnectOptions): Promise<McpConnection> {
  assertMcpContext(owner);
  assertTimerDuration('MCP request timeout', options.requestTimeoutMs);
  if (options.requestTimeoutMs === 0) throw new RangeError('MCP request timeout must be positive');
  owner = snapshotContext(owner);
  const session = await McpSession.open(config, options);
  const catalog = new McpToolCatalog(session, owner.connection, {
    requestTimeoutMs: options.requestTimeoutMs,
    ...(options.authorize === undefined ? {} : { authorize: options.authorize }),
    ...(options.maxCatalogPages === undefined ? {} : { maxPages: options.maxCatalogPages }),
  });
  const gateway = new SdkMcpGateway(owner, session, catalog, { clock: options.clock, requestTimeoutMs: options.requestTimeoutMs,
    ...(options.authorize === undefined ? {} : { authorize: options.authorize }),
  });
  return Object.freeze({ gateway, catalog, session, close: () => session.close() });
}
