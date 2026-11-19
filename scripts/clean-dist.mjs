import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fs.realpathSync(process.cwd());
const target = path.resolve(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.name, '@devduluin/viper-engine');
assert.equal(path.dirname(target), root);
if (fs.existsSync(target)) {
  assert.equal(fs.lstatSync(target).isSymbolicLink(), false, 'Refusing a linked dist directory');
  fs.rmSync(target, { recursive: true, force: true });
}
