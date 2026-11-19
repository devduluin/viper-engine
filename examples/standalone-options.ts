import { timingSafeEqual } from 'node:crypto';
import type { EngineHttpOptions, ViperEngineOptions } from '../src/index.js';
import { parseId, scopeFromAuthenticatedIdentity, sameScope } from '../src/index.js';

type Environment = Readonly<Record<string, string | undefined>>;
function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`Required standalone setting: ${name}`);
  return value;
}
function secret(env: Environment, name: string): string {
  const value = required(env, name);
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} requires 32 random bytes encoded as lowercase hex`);
  return value;
}

/** Single-owner loopback starter; replace these adapters for a multi-user deployment. */
export function standaloneOptions(env: Environment) {
  const token = secret(env, 'VIPER_LOCAL_TOKEN'); const cursorSecret = secret(env, 'VIPER_CURSOR_SECRET');
  if (token === cursorSecret) throw new Error('Bearer and cursor secrets must differ');
  const identity = { actorId: parseId('actor', required(env, 'VIPER_ACTOR_ID')), appId: parseId('app', required(env, 'VIPER_APP_ID')) };
  const owner = scopeFromAuthenticatedIdentity(identity);
  const selected = (env['VIPER_MCP_CONNECTION_IDS']?.trim() || '').split(',').filter(Boolean).map(id => ({ id: parseId('mcp_connection', id.trim()) }));
  if (selected.length > 32 || new Set(selected.map(item => item.id)).size !== selected.length) throw new Error('Invalid MCP selection');
  const http: EngineHttpOptions = {
    cursorSecret: Buffer.from(cursorSecret, 'hex'),
    authenticate: async candidate => /^[a-f0-9]{64}$/.test(candidate) && timingSafeEqual(Buffer.from(candidate), Buffer.from(token)) ? identity : undefined,
    // New MCP connections require a deployment-owned provisioning/authorization implementation.
    authorizeServer: async () => false,
  };
  const engine = {
    connections: async scope => { if (!sameScope(scope, owner)) throw new Error('Standalone owner mismatch'); return selected; },
    credentials: { resolve: async () => ({ ok: true, credential: { kind: 'none' } }),
      refresh: async () => ({ ok: false, code: 'authentication_required' }) },
    resolveEndpoint: server => {
      if (server.transport !== 'streamable_http') throw new Error('Starter supports HTTP MCP only');
      return { kind: 'streamable_http', url: server.endpointRef };
    },
    // Every callable needs exact approval; tool hints do not authorize execution.
    policy: { decide: () => 'requires_approval' },
  } satisfies Pick<ViperEngineOptions, 'credentials' | 'resolveEndpoint' | 'connections' | 'policy'>;
  return { http, engine };
}
