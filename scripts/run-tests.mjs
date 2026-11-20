import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { listFiles } from './lib/files.mjs';

const suite = process.argv[2];
if (!['unit', 'contract', 'integration'].includes(suite)) throw new Error('Expected unit, contract or integration suite');
const directory = path.resolve('tests', suite);
if (!fs.existsSync(directory)) {
  console.log(`tests/${suite}: directory not present, skipping test suite`);
  process.exit(0);
}
const files = listFiles(directory).filter(file => /\.test\.(?:ts|mjs)$/.test(file));
if (files.length === 0) {
  console.log(`tests/${suite}: no tests found, skipping test suite`);
  process.exit(0);
}
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
