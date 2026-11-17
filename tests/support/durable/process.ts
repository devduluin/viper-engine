import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

/** Child receives only review DB settings and basic platform paths, never provider credentials. */
export async function crashWorker(database: string, mode: string, marker: string,
  entrypoint = 'tests/support/durable/crash-worker.ts'): Promise<void> {
  const env: Record<string, string> = { VIPER_RESTART_DB: database, VIPER_RESTART_MODE: mode };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && (/^VIPER_TEST_DB_/.test(key) || /^(PATH|SystemRoot|WINDIR|TEMP|TMP)$/i.test(key))) env[key] = value;
  }
  const child = fork(path.resolve(entrypoint), [], {
    execArgv: ['--import', 'tsx'], env, silent: true,
  });
  child.stderr?.resume(); child.stdout?.resume();
  const exited = once(child, 'exit');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const message = await Promise.race([
      once(child, 'message').then(([value]) => value as { marker?: string }),
      exited.then(([code]) => { throw new Error(`Restart worker exited before marker (${String(code)})`); }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Restart worker marker timeout')), 10000); }),
    ]);
    assert.equal(message.marker, marker);
  } finally {
    clearTimeout(timer);
    child.kill('SIGKILL');
    await exited;
  }
}
