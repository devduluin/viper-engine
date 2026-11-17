import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFixtures } from '../../evals/lib/fixtures.mjs';
import { fixtureValidators, assertSchema } from '../../evals/lib/schema.mjs';
import { FakeMcp } from '../../evals/support/fake-mcp.mjs';

const root = process.cwd();

test('all foundation scenario definitions and tool schemas validate', () => {
  const { scenarios, catalog } = loadFixtures(root);
  assert.equal(scenarios.length, 9);
  assert.equal(catalog.tools.length, 3);
  assert.equal(scenarios.find(item => item.id === 'VE-008').expected.state, 'waiting_for_approval');
});

test('scenario schema rejects unknown fields and malformed model responses', () => {
  const validators = fixtureValidators(root);
  const { scenarios } = loadFixtures(root);
  assert.throws(() => assertSchema(validators.scenario, { ...scenarios[0], surprise: true }, 'negative'), /additionalProperties/);
  assert.throws(() => assertSchema(validators.modelResponse, { kind: 'tool_calls', calls: [] }, 'negative'), /minItems/);
  assert.throws(() => assertSchema(validators.modelResponse, { kind: 'invented' }, 'negative'), /const/);
});

test('fake MCP discovery hides canned responses and clones tool results', () => {
  const { catalog } = loadFixtures(root);
  const fake = new FakeMcp(root, catalog);
  const tools = fake.request('tools/list').tools;
  assert.equal(tools.some(tool => 'responses' in tool), false);
  const result = fake.request('tools/call', { name: 'lookup_item', arguments: { id: 'item-1' } });
  result.structuredContent.stock = 999;
  assert.equal(fake.request('tools/call', { name: 'lookup_item', arguments: { id: 'item-1' } }).structuredContent.stock, 5);
});

test('fake MCP can provide tool chain fixtures without simulating engine success', () => {
  const fake = new FakeMcp(root, loadFixtures(root).catalog);
  const item = fake.request('tools/call', { name: 'lookup_item', arguments: { id: 'item-1' } });
  const sum = fake.request('tools/call', { name: 'add_numbers', arguments: { a: item.structuredContent.stock, b: 3 } });
  assert.deepEqual(sum.structuredContent, { sum: 8 });
  assert.equal(fake.calls.length, 2);
});

test('fake MCP preserves tool errors and rejects invalid or uncanned arguments', () => {
  const fake = new FakeMcp(root, loadFixtures(root).catalog);
  assert.equal(fake.request('tools/call', { name: 'lookup_item', arguments: { id: 'missing' } }).isError, true);
  assert.throws(() => fake.request('tools/call', { name: 'lookup_item', arguments: {} }), /required/);
  assert.throws(() => fake.request('tools/call', { name: 'lookup_item', arguments: { id: 'other' } }), /No canned response/);
  assert.throws(() => fake.request('invented'), /Unsupported/);
});

test('fake MCP resources and prompts are selected explicitly', () => {
  const fake = new FakeMcp(root, loadFixtures(root).catalog);
  assert.equal(fake.request('resources/list').resources[0].uri, 'fixture://policy');
  assert.match(fake.request('resources/read', { uri: 'fixture://policy' }).contents[0].text, /reservation/);
  assert.equal(fake.request('prompts/list').prompts[0].name, 'summarize_item');
  assert.match(fake.request('prompts/get', { name: 'summarize_item', arguments: { id: 'item-1' } }).messages[0].content.text, /item-1/);
  assert.throws(() => fake.request('resources/read', { uri: 'https://unknown.invalid' }), /Unknown fixture resource/);
});
