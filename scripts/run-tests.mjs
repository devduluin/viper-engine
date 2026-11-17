import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { listFiles } from './lib/files.mjs';

const suite = process.argv[2];
if (!['unit', 'contract', 'integration'].includes(suite)) throw new Error('Expected unit, contract or integration suite');
const directory = path.resolve('tests', suite);
const files = listFiles(directory).filter(file => /\.test\.(?:ts|mjs)$/.test(file));
if (files.length === 0) throw new Error(`No ${suite} tests found; refusing empty success`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
