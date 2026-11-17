import path from 'node:path';
import { readJson, listFiles } from '../../scripts/lib/files.mjs';
import { assertSchema, fixtureValidators } from './schema.mjs';

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

export function validateCatalog(catalog, validators) {
  assertSchema(validators.catalog, catalog, 'catalog');
  assertUnique(catalog.tools.map(tool => tool.name), 'tool names');
  assertUnique(catalog.resources.map(resource => resource.uri), 'resource URIs');
  assertUnique(catalog.prompts.map(prompt => prompt.name), 'prompt names');
  for (const tool of catalog.tools) {
    const input = validators.compile(tool.inputSchema);
    const output = validators.compile(tool.outputSchema);
    for (const response of tool.responses) {
      assertSchema(input, response.arguments, `fixture input for ${tool.name}`);
      if (!response.result.isError) assertSchema(output, response.result.structuredContent, `fixture output for ${tool.name}`);
    }
  }
}

function validateScenarioReferences(scenario, catalog, validators) {
  const ids = [];
  const tools = new Map(catalog.tools.map(tool => [tool.name, tool]));
  for (const response of scenario.modelResponses) {
    if (response.kind !== 'tool_calls') continue;
    for (const call of response.calls) {
      ids.push(call.id);
      const tool = tools.get(call.name);
      if (!tool) throw new Error(`${scenario.id}: unknown fixture tool ${call.name}`);
      assertSchema(validators.compile(tool.inputSchema), call.arguments, `${scenario.id} tool args`);
    }
  }
  assertUnique(ids, `call IDs in ${scenario.id}`);
  if (scenario.expected.toolNames.some(name => !tools.has(name))) throw new Error(`${scenario.id}: unknown expected tool`);
  for (const request of scenario.contextRequests) validateContextRequest(scenario.id, request, catalog);
}

function validateContextRequest(id, request, catalog) {
  if (request.method === 'resources/read' && !catalog.resources.some(item => item.uri === request.params.uri)) {
    throw new Error(`${id}: unknown fixture resource`);
  }
  if (request.method === 'prompts/get' && !catalog.prompts.some(item => item.name === request.params.name)) {
    throw new Error(`${id}: unknown fixture prompt`);
  }
}

export function validateScenario(scenario, catalog, validators) {
  assertSchema(validators.scenario, scenario, 'scenario');
  validateScenarioReferences(scenario, catalog, validators);
}

export function loadFixtures(root) {
  const validators = fixtureValidators(root);
  const catalog = readJson(path.join(root, 'evals/fixtures/catalog.json'));
  validateCatalog(catalog, validators);
  const directory = path.join(root, 'evals/fixtures/scenarios');
  const scenarios = listFiles(directory).filter(file => file.endsWith('.json')).map(readJson);
  if (scenarios.length === 0) throw new Error('No evaluation scenarios');
  for (const scenario of scenarios) {
    validateScenario(scenario, catalog, validators);
  }
  assertUnique(scenarios.map(scenario => scenario.id), 'scenario IDs');
  return { catalog, scenarios };
}
