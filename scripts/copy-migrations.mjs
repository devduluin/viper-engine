import { mkdirSync, readdirSync, copyFileSync, lstatSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertMigrationVersion } from '../dist/bootstrap/schema-version.js';

// Fixed project paths only; no environment/config, network or database access during build.
const root = fileURLToPath(new URL('../', import.meta.url));
const relative = 'adapters/persistence/postgres/migrations';
const source = path.join(root, 'src', relative); const destination = path.join(root, 'dist', relative);
const files = readdirSync(source).filter(name => name.endsWith('.sql')).sort();
if (files.length === 0) throw new Error('No migration assets to package');
assertMigrationVersion(files.length);
for (let directory = destination; directory !== path.resolve(root); directory = path.dirname(directory)) {
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error('Refusing linked migration destination');
}
mkdirSync(destination, { recursive: true });
if (lstatSync(destination).isSymbolicLink()) throw new Error('Refusing linked migration destination');
for (const [index, name] of files.entries()) {
  if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name) || Number(name.slice(0, 4)) !== index + 1) throw new Error('Invalid migration sequence');
  const input = path.join(source, name); const output = path.join(destination, name);
  if (lstatSync(input).isSymbolicLink()) throw new Error('Refusing linked migration source');
  if (lstatSync(output, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Refusing linked migration output');
  copyFileSync(input, output);
}
const unexpected = readdirSync(destination).filter(name => name.endsWith('.sql') && !files.includes(name));
if (unexpected.length > 0) throw new Error('Stale migration assets in dist; rebuild into a fresh output directory');
console.log(`Packaged ${files.length} migration SQL assets`);
