import fs from 'node:fs';
import path from 'node:path';
import { parseSource, functionMetrics, lintDiagnostics } from './ast.mjs';
import { dependencyDiagnostics } from './dependencies.mjs';
import { listFiles, physicalLines, relativePath, sourcePattern } from './files.mjs';

function sizeDiagnostics(root, filename, text) {
  const relative = relativePath(root, filename);
  const isTest = relative.startsWith('tests/') && /\.test\./.test(filename);
  const isLoop = relative.startsWith('src/agent/runtime/');
  const limit = isLoop ? 180 : isTest ? 400 : 300;
  const count = physicalLines(text);
  return count > limit ? [{ file: filename, line: 1, code: 'FILE_SIZE', message: `${count} lines exceeds ${limit}` }] : [];
}

function metricDiagnostics(filename, source) {
  return functionMetrics(source).flatMap(metric => {
    const errors = [];
    if (metric.lines > 60) errors.push({ code: 'FUNCTION_SIZE', message: `${metric.name}: ${metric.lines} lines exceeds 60` });
    if (metric.complexity > 10) errors.push({ code: 'COMPLEXITY', message: `${metric.name}: complexity ${metric.complexity} exceeds 10` });
    return errors.map(error => ({ file: filename, line: metric.line, ...error }));
  });
}

export function analyzeProject(root, mode = 'architecture') {
  const diagnostics = [];
  const sources = new Map();
  for (const filename of listFiles(root).filter(file => sourcePattern.test(file))) {
    const text = fs.readFileSync(filename, 'utf8');
    const source = parseSource(filename, text);
    sources.set(filename, source);
    for (const diagnostic of source.parseDiagnostics) {
      diagnostics.push({ file: filename, line: 1, code: 'SYNTAX', message: String(diagnostic.messageText) });
    }
    diagnostics.push(...sizeDiagnostics(root, filename, text), ...metricDiagnostics(filename, source));
    if (relativePath(root, filename).startsWith('src/generated/')) {
      diagnostics.push({ file: filename, line: 1, code: 'UNREGISTERED_GENERATED', message: 'Register a reproducible generator before introducing generated source' });
    }
    if (mode === 'lint') diagnostics.push(...lintDiagnostics(source).map(error => ({ file: filename, ...error })));
  }
  if (mode === 'architecture') diagnostics.push(...dependencyDiagnostics(path.resolve(root), sources));
  return diagnostics;
}
