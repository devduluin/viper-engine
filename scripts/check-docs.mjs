import fs from 'node:fs';
import path from 'node:path';
import { checkDocs } from './lib/docs.mjs';

const docsDir = path.resolve('docs');
if (!fs.existsSync(docsDir)) {
  console.log('docs: directory not present, skipping docs check');
  process.exitCode = 0;
} else {
  const errors = checkDocs(process.cwd());
  for (const error of errors) console.error(error);
  console.log(`docs: ${errors.length} violation(s)`);
  process.exitCode = errors.length ? 1 : 0;
}
