import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceHashes, changedSources } from '../../support/evaluation/snapshot.js';
import { suiteEnvironment } from '../../support/regression/suites.js';

test('source snapshots pin actual bytes, detect add/change/delete and exclude environment files', () => {
  const prefix = path.join(os.tmpdir(), 'viper-snapshot-'); const root = mkdtempSync(prefix);
  try {
    mkdirSync(path.join(root, 'src')); writeFileSync(path.join(root, 'src/a.ts'), 'version1');
    writeFileSync(path.join(root, 'src/.env'), 'SYNTHETIC_DO_NOT_HASH');
    const first = sourceHashes(root, ['src'], []); assert.deepEqual(Object.keys(first), ['src/a.ts']);
    writeFileSync(path.join(root, 'src/a.ts'), 'version2'); writeFileSync(path.join(root, 'src/b.ts'), 'new');
    const second = sourceHashes(root, ['src'], []); assert.deepEqual(changedSources(first, second), ['src/a.ts', 'src/b.ts']);
    unlinkSync(path.join(root, 'src/a.ts')); assert.deepEqual(changedSources(second, sourceHashes(root, ['src'], [])), ['src/a.ts']);
    assert.throws(() => sourceHashes(root, ['..'], []), /escapes root/);
    assert.throws(() => sourceHashes(root, [], ['src/.env']), /Invalid fixed/);
  } finally { assert.ok(root.startsWith(prefix)); rmSync(root, { recursive: true, force: true }); }
});

test('test child environments include explicit test DB only when requested and no unrelated settings', () => {
  const marker = 'VIPER_REGRESSION_PRIVATE'; const previous = process.env[marker];
  process.env[marker] = 'synthetic-should-not-forward';
  try {
    assert.equal(suiteEnvironment(true)[marker], undefined); assert.equal(suiteEnvironment(false)[marker], undefined);
    assert.ok(Object.keys(suiteEnvironment(false)).every(key => !key.startsWith('VIPER_TEST_DB_')));
    assert.ok(Object.keys(suiteEnvironment(true)).every(key => /^(PATH|SystemRoot|WINDIR|TEMP|TMP|COMSPEC|PATHEXT)$/i.test(key) || key.startsWith('VIPER_TEST_DB_')));
  } finally { if (previous === undefined) delete process.env[marker]; else process.env[marker] = previous; }
});
