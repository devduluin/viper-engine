import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeProject } from '../../scripts/lib/code-checks.mjs';
import { withProject } from '../helpers/project.mjs';

function codes(files, mode = 'architecture') {
  return withProject(files, root => analyzeProject(root, mode).map(error => error.code));
}

test('valid contracts and downward dependencies pass', () => {
  assert.deepEqual(codes({
    'src/contracts/id.ts': 'export type ID = string;',
    'src/agent/use.ts': "import type { ID } from '../contracts/id.js'; export const value: ID = 'ok';",
  }), []);
});

test('file limits include physical blanks/comments and loop has tighter limit', () => {
  assert.ok(codes({ 'src/shared/large.ts': '// comment\n'.repeat(301) }).includes('FILE_SIZE'));
  assert.ok(codes({ 'src/agent/runtime/loop.ts': '\n'.repeat(181) }).includes('FILE_SIZE'));
  assert.deepEqual(codes({ 'src/agent/runtime/loop.ts': '// line\n'.repeat(180) }), []);
});

test('function limit is AST based, including arrows and methods', () => {
  const body = '\n'.repeat(60);
  for (const source of [`export function large() {${body}}`, `export const fn = () => {${body}};`, `class X { run() {${body}} }`]) {
    assert.ok(codes({ 'src/shared/large.ts': source }).includes('FUNCTION_SIZE'));
  }
});

test('complexity rejects branch-heavy functions and checks nested callbacks independently', () => {
  const branches = 'if (x) x--;\n'.repeat(10);
  const source = `export const outer = () => (x: number) => {${branches} return x;};`;
  assert.ok(codes({ 'src/shared/complex.ts': source }).includes('COMPLEXITY'));
});

test('type imports, reexports, dynamic imports and require obey layers', () => {
  for (const statement of [
    "import type { Value } from '../adapters/db/store.js';",
    "export { value } from '../adapters/db/store.js';",
    "const value = import('../adapters/db/store.js');",
    "const value = require('../adapters/db/store.js');",
  ]) {
    assert.ok(codes({
      'src/agent/use.ts': statement,
      'src/adapters/db/store.ts': 'export type Value = string; export const value = 1;',
    }).includes('LAYER_IMPORT'));
  }
});

test('core SDK imports, dynamic paths, unresolved imports and unknown layers fail closed', () => {
  assert.ok(codes({ 'src/agent/use.ts': "import fs from 'node:fs';" }).includes('EXTERNAL_IMPORT'));
  assert.ok(codes({ 'src/agent/use.ts': 'export const load = (name: string) => import(name);' }).includes('DYNAMIC_IMPORT'));
  assert.ok(codes({ 'src/shared/use.ts': "import './missing.js';" }).includes('UNRESOLVED_IMPORT'));
  assert.ok(codes({ 'src/misc.ts': 'export const value = 1;' }).includes('UNKNOWN_LAYER'));
});

test('cycles and coupling between adapter families are rejected', () => {
  assert.ok(codes({
    'src/shared/a.ts': "export { b } from './b.js'; export const a = 1;",
    'src/shared/b.ts': "export { a } from './a.js'; export const b = 2;",
  }).includes('DEPENDENCY_CYCLE'));
  assert.ok(codes({
    'src/adapters/mcp/a.ts': "import '../database/b.js';",
    'src/adapters/database/b.ts': 'export const value = 1;',
  }).includes('ADAPTER_COUPLING'));
});

test('tsconfig path aliases cannot bypass dependency direction', () => {
  assert.ok(codes({
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@db/*': ['src/adapters/db/*'] } } }),
    'src/agent/use.ts': "import '@db/store';",
    'src/adapters/db/store.ts': 'export const value = 1;',
  }).includes('LAYER_IMPORT'));
});

test('production source cannot import tooling or unregistered generated source', () => {
  assert.ok(codes({
    'src/bootstrap/use.ts': "import '../../scripts/helper.mjs';",
    'scripts/helper.mjs': 'export const value = 1;',
  }).includes('NON_SOURCE_IMPORT'));
  assert.ok(codes({ 'src/generated/bypass.ts': '// Generated\nexport const value = 1;' }).includes('UNREGISTERED_GENERATED'));
});

test('lint rejects explicit any and type bypass comments without matching string data', () => {
  assert.ok(codes({ 'src/shared/use.ts': 'export const value: any = 1;' }, 'lint').includes('EXPLICIT_ANY'));
  const directive = ['@ts', 'ignore'].join('-');
  assert.ok(codes({ 'src/shared/use.ts': `// ${directive}\nexport const value = 1;` }, 'lint').includes('TYPE_BYPASS'));
  assert.deepEqual(codes({ 'src/shared/use.ts': `export const value = '${directive}';` }, 'lint'), []);
});
