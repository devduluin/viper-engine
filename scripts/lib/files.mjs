import fs from 'node:fs';
import path from 'node:path';

const ignored = new Set(['node_modules', '.git', 'dist', 'coverage', 'artifacts']);
export const sourcePattern = /\.(?:[cm]?[jt]sx?)$/;

export function listFiles(root, directory = root) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink not allowed in source tree: ${fullPath}`);
    if (entry.isDirectory()) files.push(...listFiles(root, fullPath));
    else files.push(fullPath);
  }
  return files.sort();
}

export function relativePath(root, filename) {
  return path.relative(root, filename).split(path.sep).join('/');
}

export function isInside(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function physicalLines(text) {
  if (text === '') return 0;
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

export function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}
