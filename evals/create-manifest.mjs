import fs from 'node:fs';
import path from 'node:path';
import { createManifest } from './lib/manifest.mjs';

const filename = path.resolve('evals/manifests/foundation.json');
fs.mkdirSync(path.dirname(filename), { recursive: true });
fs.writeFileSync(filename, `${JSON.stringify(createManifest(process.cwd()), null, 2)}\n`);
console.log('Foundation input hashes updated; benchmark status remains NOT MEASURED.');
