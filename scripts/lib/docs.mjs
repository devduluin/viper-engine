import fs from 'node:fs';
import path from 'node:path';
import { listFiles, physicalLines, readJson, isInside } from './files.mjs';

function linkDiagnostics(root, filename, text) {
  const errors = [];
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (target.includes('://') || target.startsWith('#')) continue;
    const filePart = decodeURIComponent(target.split('#')[0]);
    const resolved = path.resolve(path.dirname(filename), filePart);
    if (!isInside(root, resolved)) errors.push(`${filename}: link outside standalone project ${target}`);
    else if (!fs.existsSync(resolved)) errors.push(`${filename}: broken link ${target}`);
  }
  return errors;
}

export function taskDefinitions(root) {
  const plan = fs.readFileSync(path.join(root, 'docs/development-plan.md'), 'utf8');
  return [...plan.matchAll(/^- \*\*(P\d{2}-\d{2}) - (.+?)\.\*\*/gm)].map(match => ({ id: match[1], title: match[2] }));
}

export function validateTaskGraph(definitions, graph) {
  const errors = [];
  const ids = definitions.map(task => task.id);
  if (ids.length !== 36 || new Set(ids).size !== 36) errors.push('Expected 36 unique active task definitions');
  if (JSON.stringify(ids) !== JSON.stringify(Object.keys(graph))) errors.push('Task graph must match active plan IDs/order');
  for (const [id, dependencies] of Object.entries(graph)) {
    if (!Array.isArray(dependencies) || dependencies.some(dep => !ids.includes(dep))) errors.push(`Invalid dependencies for ${id}`);
  }
  const visited = new Set();
  const visit = (id, active = []) => {
    if (active.includes(id)) return errors.push(`Task dependency cycle: ${[...active, id].join(' -> ')}`);
    if (visited.has(id)) return;
    for (const dependency of graph[id] ?? []) visit(dependency, [...active, id]);
    visited.add(id);
  };
  if (errors.length === 0) for (const id of ids) visit(id);
  return errors;
}

export function taskDiagnostics(root) {
  const definitions = taskDefinitions(root);
  const checklist = fs.readFileSync(path.join(root, 'docs/development-checklist.md'), 'utf8');
  const tracked = [...checklist.matchAll(/^- \[[ x]\] \*\*(P\d{2}-\d{2})\*\*/gm)].map(match => match[1]);
  const errors = [];
  if (JSON.stringify(definitions.map(task => task.id)) !== JSON.stringify(tracked)) errors.push('Task checklist must match plan IDs/order');
  const graph = readJson(path.join(root, 'docs/task-dependencies.json'));
  errors.push(...validateTaskGraph(definitions, graph));
  const completed = new Set([...checklist.matchAll(/^- \[x\] \*\*(P\d{2}-\d{2})\*\*/gm)].map(match => match[1]));
  for (const id of completed) {
    if (graph[id]?.some(dependency => !completed.has(dependency))) errors.push(`${id}: completed before its dependencies`);
  }
  return errors;
}

export function checkDocs(root) {
  const errors = [];
  for (const filename of listFiles(root).filter(file => file.endsWith('.md'))) {
    const text = fs.readFileSync(filename, 'utf8');
    if (physicalLines(text) > 300) errors.push(`${filename}: Markdown exceeds 300 lines`);
    if (text.split(/\r?\n/).filter(line => line.startsWith('```')).length % 2) errors.push(`${filename}: unbalanced fences`);
    errors.push(...linkDiagnostics(root, filename, text));
  }
  return [...errors, ...taskDiagnostics(root)];
}

export function readyTasks(root) {
  const errors = taskDiagnostics(root);
  if (errors.length) throw new Error(errors.join('\n'));
  const checklist = fs.readFileSync(path.join(root, 'docs/development-checklist.md'), 'utf8');
  const completed = new Set([...checklist.matchAll(/^- \[x\] \*\*(P\d{2}-\d{2})\*\*/gm)].map(match => match[1]));
  const graph = readJson(path.join(root, 'docs/task-dependencies.json'));
  return taskDefinitions(root).filter(task => !completed.has(task.id)
    && graph[task.id].every(dependency => completed.has(dependency)));
}
