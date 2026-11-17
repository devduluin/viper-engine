type Environment = Readonly<Record<string, string | undefined>>;

/** Connection settings for the engine's own PostgreSQL database (schema `viper_engine`). */
export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  /** Absent when the server uses trust/peer auth (local development). */
  readonly password?: string;
  readonly ssl: boolean;
  readonly maxConnections: number;
}

function required(env: Environment, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${key} is required`);
  return value;
}

function integer(env: Environment, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim() || String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${key}`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`Invalid ${key}`);
  return value;
}

function flag(env: Environment, key: string): boolean {
  const raw = env[key]?.trim().toLowerCase() || 'false';
  if (raw !== 'true' && raw !== 'false') throw new Error(`${key} must be true or false`);
  return raw === 'true';
}

/**
 * Reads `<prefix>_HOST`, `_PORT`, `_NAME`, `_USER`, `_PASSWORD`, `_SSL`, `_POOL_MAX`.
 * Separate variables instead of a URL, so no value needs URL-encoding and nothing is guessed.
 */
export function parseDatabaseConfig(env: Environment, prefix = 'VIPER_DB'): DatabaseConfig {
  const host = required(env, `${prefix}_HOST`);
  if (/\s/.test(host)) throw new Error(`Invalid ${prefix}_HOST`);
  const database = required(env, `${prefix}_NAME`);
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(database)) throw new Error(`Invalid ${prefix}_NAME`);
  const password = env[`${prefix}_PASSWORD`];
  return Object.freeze({
    host, database,
    port: integer(env, `${prefix}_PORT`, 5432, 1, 65_535),
    user: required(env, `${prefix}_USER`),
    ...(password === undefined || password.length === 0 ? {} : { password }),
    ssl: flag(env, `${prefix}_SSL`),
    maxConnections: integer(env, `${prefix}_POOL_MAX`, 10, 1, 100),
  });
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host);
}
