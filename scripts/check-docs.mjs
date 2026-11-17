import { checkDocs } from './lib/docs.mjs';

const errors = checkDocs(process.cwd());
for (const error of errors) console.error(error);
console.log(`docs: ${errors.length} violation(s)`);
process.exitCode = errors.length ? 1 : 0;
