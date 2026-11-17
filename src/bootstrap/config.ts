export interface FoundationConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

type Environment = Readonly<Record<string, string | undefined>>;

function choose<T extends string>(
  value: string | undefined,
  fallback: T,
  values: readonly T[],
  key: string,
): T {
  const candidate = value ?? fallback;
  if (!values.includes(candidate as T)) throw new Error(`Invalid ${key}`);
  return candidate as T;
}

function readPort(value: string | undefined): number {
  const candidate = value ?? '3010';
  if (!/^\d+$/.test(candidate)) throw new Error('Invalid VIPER_PORT');
  const port = Number(candidate);
  if (port < 1 || port > 65_535) throw new Error('Invalid VIPER_PORT');
  return port;
}

export function parseFoundationConfig(env: Environment): FoundationConfig {
  const host = env['VIPER_HOST'] ?? '127.0.0.1';
  if (host.length === 0 || /\s/.test(host)) throw new Error('Invalid VIPER_HOST');
  return Object.freeze({
    environment: choose(env['VIPER_ENV'], 'development', ['development', 'test', 'production'], 'VIPER_ENV'),
    host,
    port: readPort(env['VIPER_PORT']),
    logLevel: choose(env['VIPER_LOG_LEVEL'], 'info', ['debug', 'info', 'warn', 'error'], 'VIPER_LOG_LEVEL'),
  });
}
