import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ignored = new Set(['node_modules', '.git', 'dist', 'coverage', 'artifacts']);
function inside(root: string, filename: string) {
  const relative = path.relative(root, filename);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Snapshot path escapes root');
}
function filesIn(root: string, directory: string): string[] {
  inside(root, directory); const files: string[] = [];
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Snapshot refuses source symlinks');
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ignored.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Snapshot refuses source symlinks');
    if (entry.isDirectory()) files.push(...filesIn(root, filename));
    else files.push(filename);
  }
  return files;
}
/** Explicit code/fixture roots only; never discover credentials or load environment files. */
export function sourceHashes(root: string, directories: readonly string[], fixed: readonly string[]) {
  root = path.resolve(root);
  const files = [...directories.flatMap(directory => filesIn(root, path.resolve(root, directory))), ...fixed.map(file => path.resolve(root, file))];
  return Object.fromEntries([...new Set(files)].sort().map(filename => {
    inside(root, filename);
    if (path.basename(filename).startsWith('.') || lstatSync(filename).isSymbolicLink()) throw new Error('Invalid fixed snapshot file');
    return [path.relative(root, filename).split(path.sep).join('/'), createHash('sha256').update(readFileSync(filename)).digest('hex')];
  }));
}
export function changedSources(before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => before[key] !== after[key]).sort();
}
