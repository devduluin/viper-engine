import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpCapabilities } from '../../../contracts/mcp/capabilities.js';
import type { McpTransportConfig } from './transport.js';
import { createTransport, stderrTail } from './transport.js';
import { assertTimerDuration } from '../../../shared/async/delay.js';

export interface McpSessionOptions {
  readonly connectTimeoutMs: number;
  readonly clientName?: string;
  readonly clientVersion?: string;
  /** Test seam; production builds the transport from config. */
  readonly transport?: Transport;
}

type Listener = () => void;

function capabilitiesOf(protocolVersion: string, server: ServerCapabilities | undefined): McpCapabilities {
  const flag = (value: boolean | undefined) => (value === undefined ? {} : { listChanged: value });
  return Object.freeze({
    protocolVersion,
    ...(server?.tools === undefined ? {} : { tools: Object.freeze(flag(server.tools.listChanged)) }),
    ...(server?.resources === undefined ? {} : {
      resources: Object.freeze({
        ...flag(server.resources.listChanged),
        ...(server.resources.subscribe === undefined ? {} : { subscribe: server.resources.subscribe }),
      }),
    }),
    ...(server?.prompts === undefined ? {} : { prompts: Object.freeze(flag(server.prompts.listChanged)) }),
  });
}

/** Records the protocol version the SDK negotiated; stdio transports do not track it themselves. */
function observeProtocolVersion(transport: Transport): { readonly value: () => string | undefined } {
  let negotiated: string | undefined;
  const original = transport.setProtocolVersion?.bind(transport);
  transport.setProtocolVersion = (version: string) => {
    negotiated = version;
    original?.(version);
  };
  return { value: () => negotiated };
}

/**
 * A failed stdio connect carries the server's recent stderr as a non-enumerable `stderr`
 * property: available to host logging, kept out of the message so it never reaches the model.
 */
function withStderr(error: unknown, transport: Transport): unknown {
  const tail = stderrTail(transport);
  if (tail !== undefined && typeof error === 'object' && error !== null && Object.isExtensible(error)) {
    Object.defineProperty(error, 'stderr', { value: tail, enumerable: false, configurable: true });
  }
  return error;
}

/**
 * One initialized MCP client connection. Closing it (or the server going away) fires the
 * invalidation listeners exactly once, so catalogs never outlive their connection.
 */
export class McpSession {
  private readonly listeners = new Set<Listener>();
  private isClosed = false;

  private constructor(readonly client: Client, readonly capabilities: McpCapabilities, private readonly transport: Transport) {}

  static async open(config: McpTransportConfig, options: McpSessionOptions): Promise<McpSession> {
    assertTimerDuration('MCP connect timeout', options.connectTimeoutMs);
    if (options.connectTimeoutMs === 0) throw new RangeError('MCP connect timeout must be positive');
    const transport = options.transport ?? createTransport(config);
    const version = observeProtocolVersion(transport);
    const client = new Client({ name: options.clientName ?? 'viper-engine', version: options.clientVersion ?? '0.1.0' });
    try {
      await client.connect(transport, { timeout: options.connectTimeoutMs });
    } catch (error) {
      await client.close().catch(() => undefined);
      throw withStderr(error, transport);
    }
    const negotiated = version.value();
    if (negotiated === undefined) {
      await client.close();
      throw new Error('MCP initialize did not negotiate a protocol version');
    }
    const session = new McpSession(client, capabilitiesOf(negotiated, client.getServerCapabilities()), transport);
    session.wire();
    return session;
  }

  get closed(): boolean { return this.isClosed; }

  /** Recent stderr of a stdio server (host diagnostics only; never shown to the model). */
  get stderr(): string | undefined { return stderrTail(this.transport); }

  /** Fires on tools/list_changed and on close; returns an unsubscribe function. */
  onInvalidate(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.markClosed();
    await this.client.close();
  }

  private wire(): void {
    this.client.onclose = () => this.markClosed();
    if (this.capabilities.tools !== undefined) {
      this.client.setNotificationHandler(ToolListChangedNotificationSchema, () => this.notify());
    }
  }

  private markClosed(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* Observer failure must not prevent transport cleanup or cache invalidation. */ }
    }
  }
}
