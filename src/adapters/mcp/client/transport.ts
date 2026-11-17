import { StringDecoder } from 'node:string_decoder';
import type { McpCredential } from '../../../contracts/mcp/access.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

/**
 * Connector configuration resolved by the application from `mcp_servers`. Secrets never live
 * here as literals in storage; P05-03 resolves credential references into headers/env.
 */
export type McpTransportConfig =
  | {
    readonly kind: 'stdio';
    /** Runs on the backend host, never on the end user's machine. */
    readonly command: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly cwd?: string;
    /**
     * `capture` (default) always drains the child's stderr into a bounded tail (see `stderrTail`),
     * so a chatty server can never block on a full pipe and crash output stays diagnosable.
     */
    readonly stderr?: 'capture' | 'ignore' | 'inherit';
  }
  | {
    readonly kind: 'streamable_http';
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
  };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Last characters of a stdio server's stderr kept for diagnostics. */
export const STDERR_TAIL_CHARS = 8 * 1024;
const tails = new WeakMap<Transport, { text: string }>();

/** Recent stderr of a captured stdio transport; undefined for other transports or when empty. */
export function stderrTail(transport: Transport): string | undefined {
  const text = tails.get(transport)?.text;
  return text === undefined || text.length === 0 ? undefined : text;
}

function capture(transport: StdioClientTransport): StdioClientTransport {
  const tail = { text: '' };
  tails.set(transport, tail);
  const decoder = new StringDecoder('utf8');
  transport.stderr?.on('data', (chunk: Buffer | string) => {
    tail.text = (tail.text + (typeof chunk === 'string' ? chunk : decoder.write(chunk))).slice(-STDERR_TAIL_CHARS);
  });
  return transport;
}

/** HTTPS is required except for loopback development servers. */
export function parseHttpEndpoint(raw: string): URL {
  const url = new URL(raw);
  if (url.username !== '' || url.password !== '') throw new Error('MCP endpoint URL must not embed credentials');
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOOPBACK.has(url.hostname)) return url;
  throw new Error('MCP Streamable HTTP endpoint must use https (http only for loopback)');
}

function stdioTransport(config: Extract<McpTransportConfig, { kind: 'stdio' }>): StdioClientTransport {
  if (config.command.trim().length === 0) throw new Error('MCP stdio command is required');
  const mode = config.stderr ?? 'capture';
  const transport = new StdioClientTransport({
    command: config.command,
    args: [...(config.args ?? [])],
    // Only the SDK's minimal default environment plus explicit entries; never the full process env.
    ...(config.env === undefined ? {} : { env: { ...config.env } }),
    ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
    stderr: mode === 'capture' ? 'pipe' : mode,
  });
  return mode === 'capture' ? capture(transport) : transport;
}

export function createTransport(config: McpTransportConfig): Transport {
  if (config.kind === 'stdio') return stdioTransport(config);
  return new StreamableHTTPClientTransport(parseHttpEndpoint(config.url), {
    requestInit: { headers: { ...(config.headers ?? {}) }, redirect: 'error' },
  });
}

/**
 * Applies a resolved credential to one session's transport. A bearer token only travels as an
 * HTTP Authorization header; environment variables only reach a stdio subprocess.
 */
export function withCredential(config: McpTransportConfig, credential: McpCredential): McpTransportConfig {
  if (credential.kind === 'none') return config;
  if (credential.kind === 'bearer') {
    if (config.kind !== 'streamable_http') throw new Error('Bearer credentials require the Streamable HTTP transport');
    return { ...config, headers: { ...(config.headers ?? {}), Authorization: `Bearer ${credential.token}` } };
  }
  if (config.kind !== 'stdio') throw new Error('Environment credentials require the stdio transport');
  return { ...config, env: { ...(config.env ?? {}), ...credential.variables } };
}
