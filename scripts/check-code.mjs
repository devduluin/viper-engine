import path from 'node:path';
import { analyzeProject } from './lib/code-checks.mjs';
import { relativePath } from './lib/files.mjs';

const mode = process.argv[2];
if (!['lint', 'architecture'].includes(mode)) throw new Error('Expected lint or architecture');
const root = path.resolve(process.cwd());
const diagnostics = analyzeProject(root, mode);
for (const diagnostic of diagnostics) {
  console.error(`${relativePath(root, diagnostic.file)}:${diagnostic.line} [${diagnostic.code}] ${diagnostic.message}`);
}
console.log(`${mode}: ${diagnostics.length} violation(s)`);
process.exitCode = diagnostics.length ? 1 : 0;
