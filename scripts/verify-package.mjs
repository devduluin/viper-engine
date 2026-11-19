import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(pkg.name, '@devduluin/viper-engine');
assert.notEqual(pkg.private, true, 'private:true prevents publishing even to a private registry');
assert.deepEqual(pkg.files, ['dist']);
assert.equal(pkg.publishConfig.registry, 'https://npm.pkg.github.com');
for (const file of [pkg.exports['.'], pkg.types]) assert.ok(fs.statSync(file).isFile(), `Missing package entry ${file}`);
const source = 'src/adapters/persistence/postgres/migrations';
const output = 'dist/adapters/persistence/postgres/migrations';
const migrations = fs.readdirSync(source).filter(file => file.endsWith('.sql')).sort();
assert.ok(migrations.length > 0);
assert.deepEqual(fs.readdirSync(output).filter(file => file.endsWith('.sql')).sort(), migrations);
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const file of migrations) assert.equal(hash(path.join(output, file)), hash(path.join(source, file)), `Stale SQL asset ${file}`);
console.log(`Package verified: ${pkg.name}@${pkg.version}; ${migrations.length} exact SQL assets; dist-only allowlist`);
