import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { loadFixtures, validateScenario, validateCatalog } from '../../evals/lib/fixtures.mjs';
import { fixtureValidators } from '../../evals/lib/schema.mjs';
import { verifyManifest } from '../../evals/lib/manifest.mjs';
import { listFiles, relativePath } from '../../scripts/lib/files.mjs';
import { withProject } from '../helpers/project.mjs';

const root = process.cwd();

test('semantic references reject unknown tools, bad args and duplicate call IDs', () => {
  const { catalog, scenarios } = loadFixtures(root);
  const validators = fixtureValidators(root);
  const original = scenarios.find(scenario => scenario.id === 'VE-003');
  const unknown = structuredClone(original);
  unknown.modelResponses[0].calls[0].name = 'unknown';
  assert.throws(() => validateScenario(unknown, catalog, validators), /unknown fixture tool/);
  const invalid = structuredClone(original);
  invalid.modelResponses[0].calls[0].arguments = {};
  assert.throws(() => validateScenario(invalid, catalog, validators), /required/);
  const duplicate = structuredClone(original);
  duplicate.modelResponses[1].calls[0].id = duplicate.modelResponses[0].calls[0].id;
  assert.throws(() => validateScenario(duplicate, catalog, validators), /Duplicate call IDs/);
});

test('catalog rejects duplicate definitions and invalid canned output', () => {
  const validators = fixtureValidators(root);
  const original = loadFixtures(root).catalog;
  const duplicate = structuredClone(original);
  duplicate.tools.push(duplicate.tools[0]);
  assert.throws(() => validateCatalog(duplicate, validators), /Duplicate tool/);
  const invalid = structuredClone(original);
  invalid.tools[0].responses[0].result.structuredContent.stock = 'wrong';
  assert.throws(() => validateCatalog(invalid, validators), /fixture output/);
});

function manifestProject() {
  const directories = ['evals/fixtures', 'evals/schemas'];
  const fixed = ['evals/rubric.md', 'evals/manifests/foundation.json'];
  const files = [...directories.flatMap(name => listFiles(path.join(root, name))), ...fixed.map(name => path.join(root, name))];
  return Object.fromEntries(files.map(filename => [relativePath(root, filename), fs.readFileSync(filename, 'utf8')]));
}

test('foundation manifest rejects dataset drift and invented benchmark results', () => {
  withProject(manifestProject(), temporary => {
    verifyManifest(temporary);
    const filename = path.join(temporary, 'evals/fixtures/catalog.json');
    const catalog = JSON.parse(fs.readFileSync(filename, 'utf8'));
    catalog.resources[0].text = 'Changed';
    fs.writeFileSync(filename, JSON.stringify(catalog));
    assert.throws(() => verifyManifest(temporary), /manifest drift/);
  });
  withProject(manifestProject(), temporary => {
    const filename = path.join(temporary, 'evals/manifests/foundation.json');
    const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
    manifest.engines.hermes = 'passed';
    fs.writeFileSync(filename, JSON.stringify(manifest));
    assert.throws(() => verifyManifest(temporary), /foundation manifest/);
  });
});
