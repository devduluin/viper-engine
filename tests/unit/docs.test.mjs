import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { checkDocs, validateTaskGraph, readyTasks } from '../../scripts/lib/docs.mjs';
import { withProject } from '../helpers/project.mjs';

function docsProject(readme) {
  const ids = Array.from({ length: 36 }, (_, index) => `P${String(Math.floor(index / 4)).padStart(2, '0')}-${String(index % 4 + 1).padStart(2, '0')}`);
  return {
    'README.md': readme,
    'docs/development-plan.md': ids.map(id => `- **${id} - Example.**`).join('\n'),
    'docs/development-checklist.md': ids.map(id => `- [ ] **${id}** - Example`).join('\n'),
    'docs/task-dependencies.json': JSON.stringify(Object.fromEntries(ids.map(id => [id, []]))),
  };
}

test('docs checker rejects broken links and unmatched fences', () => {
  withProject(docsProject('[missing](missing.md)\n```\n'), root => {
    const errors = checkDocs(root);
    assert.ok(errors.some(error => error.includes('broken link')));
    assert.ok(errors.some(error => error.includes('unbalanced fences')));
  });
});

test('valid documentation passes and oversized Markdown fails', () => {
  withProject(docsProject('# Valid\n'), root => assert.deepEqual(checkDocs(root), []));
  withProject(docsProject('text\n'.repeat(301)), root => {
    assert.ok(checkDocs(root).some(error => error.includes('exceeds 300')));
  });
});

test('checked task cannot be completed before its dependencies', () => {
  const files = docsProject('# Valid\n');
  const graph = JSON.parse(files['docs/task-dependencies.json']);
  graph['P00-02'] = ['P00-01'];
  files['docs/task-dependencies.json'] = JSON.stringify(graph);
  files['docs/development-checklist.md'] = files['docs/development-checklist.md'].replace('- [ ] **P00-02**', '- [x] **P00-02**');
  withProject(files, root => assert.ok(checkDocs(root).some(error => error.includes('completed before'))));
});

test('documentation cannot depend on sibling repository files', () => {
  withProject(docsProject('[outside](../legacy/file.ts)\n'), root => {
    assert.ok(checkDocs(root).some(error => error.includes('outside standalone project')));
  });
});

test('P00 completion opens exactly the two independent initial lanes', () => {
  const files = docsProject('# Valid\n');
  files['docs/task-dependencies.json'] = fs.readFileSync('docs/task-dependencies.json', 'utf8');
  for (const id of ['P00-01', 'P00-02', 'P00-03', 'P00-04']) {
    files['docs/development-checklist.md'] = files['docs/development-checklist.md'].replace(`- [ ] **${id}**`, `- [x] **${id}**`);
  }
  withProject(files, root => assert.deepEqual(readyTasks(root).map(task => task.id), ['P01-01', 'P02-01']));
});

test('task graph validation rejects cycles and unknown dependencies', () => {
  const definitions = Array.from({ length: 36 }, (_, index) => ({ id: `task-${index}` }));
  const graph = Object.fromEntries(definitions.map(task => [task.id, []]));
  assert.deepEqual(validateTaskGraph(definitions, graph), []);
  graph['task-0'] = ['task-1'];
  graph['task-1'] = ['task-0'];
  assert.ok(validateTaskGraph(definitions, graph).some(error => error.includes('cycle')));
  graph['task-0'] = ['unknown'];
  assert.ok(validateTaskGraph(definitions, graph).some(error => error.includes('Invalid dependencies')));
});
