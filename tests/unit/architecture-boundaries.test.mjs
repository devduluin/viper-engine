import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { analyzeProject } from '../../scripts/lib/code-checks.mjs';
import { withProject } from '../helpers/project.mjs';

test('external sibling source cannot be imported even by bootstrap', () => {
  withProject({ 'outside.ts': 'export const value = 1;' }, outer => {
    const content = `import '${path.join(outer, 'outside.ts').replaceAll('\\', '/')}';`;
    withProject({ 'src/bootstrap/use.ts': content }, root => {
      assert.ok(analyzeProject(root).some(error => error.code === 'OUTSIDE_IMPORT'));
    });
  });
});

test('CLI exits nonzero for architectural violations', () => {
  withProject({ 'src/shared/large.ts': '// line\n'.repeat(301) }, root => {
    const executable = path.resolve('scripts/check-code.mjs');
    const result = spawnSync(process.execPath, [executable, 'architecture'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FILE_SIZE/);
  });
});

test('JavaScript and nested callbacks are subject to metrics', () => {
  withProject({ 'scripts/helper.mjs': `export const outer = () => () => {${'\n'.repeat(61)}};` }, root => {
    assert.ok(analyzeProject(root).some(error => error.code === 'FUNCTION_SIZE'));
  });
});

test('production symlinks cannot hide external source', () => {
  withProject({ 'target/value.ts': 'export const value = 1;', 'src/shared/use.ts': 'export const value = 2;' }, root => {
    const link = path.join(root, 'src/shared/link');
    fs.symlinkSync(path.join(root, 'target'), link, 'junction');
    assert.throws(() => analyzeProject(root), /Symlink not allowed/);
  });
});
