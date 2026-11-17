import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { connectMcp } from '../../../src/adapters/mcp/client/connect.js';
import type { McpConnection } from '../../../src/adapters/mcp/client/connect.js';
import { TestClock } from '../agent/identity.js';
import { testConnection, testScope } from '../agent/setup.js';
import { createFixtureServer } from './fixture-server.js';
import type { FixtureOptions } from './fixture-server.js';

export const owner = Object.freeze({ scope: testScope(), connection: testConnection() });
const ENTRY = path.resolve('tests/support/mcp/stdio-entry.ts');

export interface StdioFixture extends McpConnection {
  readonly transport: StdioClientTransport;
}

/** Real subprocess over stdio; the transport is exposed so tests can check the child pid. */
export async function stdioFixture(options: { toolsOnly?: boolean; requestTimeoutMs?: number } = {}): Promise<StdioFixture> {
  const args = ['--import', 'tsx', ENTRY, ...(options.toolsOnly === true ? ['--tools-only'] : [])];
  const transport = new StdioClientTransport({ command: process.execPath, args, cwd: process.cwd(), stderr: 'ignore' });
  const connection = await connectMcp(owner, { kind: 'stdio', command: process.execPath, args }, {
    transport, clock: new TestClock(Date.now()), connectTimeoutMs: 20_000, requestTimeoutMs: options.requestTimeoutMs ?? 5_000,
  });
  return Object.freeze({ ...connection, transport });
}

export interface HttpServerFixture {
  readonly url: string;
  /** Number of HTTP requests that reached the server, including rejected ones. */
  readonly requests: () => number;
  expireSessions(): void;
  stop(): Promise<void>;
}

/**
 * In-process Streamable HTTP MCP server on an ephemeral loopback port, one transport per session.
 * With `token`, every request must carry `Authorization: Bearer <token()>` or gets HTTP 401.
 */
export async function startHttpServer(options: { token?: () => string; fixture?: FixtureOptions } = {}): Promise<HttpServerFixture> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const expired = new Set<string>();
  let count = 0;
  const http = createServer(async (request, response) => {
    count += 1;
    if (options.token !== undefined && request.headers.authorization !== `Bearer ${options.token()}`) {
      response.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}');
      return;
    }
    const id = request.headers['mcp-session-id'];
    if (typeof id === 'string' && expired.has(id)) { response.writeHead(404).end(); return; }
    let transport = typeof id === 'string' ? sessions.get(id) : undefined;
    if (transport === undefined) {
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(), onsessioninitialized: sessionId => { sessions.set(sessionId, created); },
      });
      await createFixtureServer({ ...options.fixture, crash: () => { void created.close(); } }).connect(created);
      transport = created;
    }
    await transport.handleRequest(request, response);
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  return Object.freeze({
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
    requests: () => count,
    expireSessions() { for (const id of sessions.keys()) expired.add(id); },
    async stop() {
      await Promise.all([...sessions.values()].map(transport => transport.close()));
      http.closeAllConnections();
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  });
}

export interface HttpFixture extends McpConnection {
  readonly url: string;
  stop(): Promise<void>;
}

export async function httpFixture(options: { requestTimeoutMs?: number } = {}): Promise<HttpFixture> {
  const server = await startHttpServer();
  const connection = await connectMcp(owner, { kind: 'streamable_http', url: server.url }, {
    clock: new TestClock(Date.now()), connectTimeoutMs: 10_000, requestTimeoutMs: options.requestTimeoutMs ?? 5_000,
  });
  return Object.freeze({
    ...connection, url: server.url,
    async stop() {
      await connection.close();
      await server.stop();
    },
  });
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
