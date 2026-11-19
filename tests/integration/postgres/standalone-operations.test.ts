import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createDatabase, testServerConfig } from './database.js';
import { suiteEnvironment } from '../../support/regression/suites.js';

test('compiled standalone engine bootstraps a fresh DB and recovers queued work with authenticated health', async () => {
  const db = await createDatabase({ migrated: false });
  try {
    const config = testServerConfig();
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['tests/support/operations/compiled-smoke.mjs'], { env: {
        ...suiteEnvironment(true), VIPER_TEST_DB_NAME: db.name, VIPER_TEST_DB_PORT: String(config.port),
      }, timeout: 30000 });
      let text = '';
      child.stdout.on('data', (chunk: Buffer) => { text += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { text += chunk.toString(); });
      child.on('error', reject);
      child.on('close', code => { if (code === 0) resolve(text); else reject(new Error(`Compiled operations smoke failed (${code}): ${text}`)); });
    });
    assert.match(output, /"passed":true/); assert.match(output, /"persistedRun":"completed"/);
  } finally { await db.drop(); }
});
