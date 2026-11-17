import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JsonSchemaToolValidator } from '../../src/adapters/validation/tool-schema.js';

test('production validator enforces nested JSON Schema without coercion, defaults or removal', () => {
  const validator = new JsonSchemaToolValidator();
  const schema = { type: 'object', properties: { count: { type: 'integer', minimum: 1, default: 5 },
    nested: { $ref: '#/$defs/nested' } }, required: ['count'], additionalProperties: false,
    $defs: { nested: { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] } } };
  assert.deepEqual(validator.validate(schema, { count: 2, nested: { email: 'a@example.com' } }), { ok: true });
  for (const args of [{}, { count: '2' }, { count: 0 }, { count: 2, extra: true }, { count: 2, nested: { email: 'invalid' } }]) {
    const copy = structuredClone(args);
    assert.equal(validator.validate(schema, args).ok, false);
    assert.deepEqual(args, copy);
  }
  assert.equal(validator.validate(schema, Object.freeze({ count: 3 })).ok, true);
});

test('schemas are isolated by definition, support draft7, and survive bounded cache eviction', () => {
  const validator = new JsonSchemaToolValidator(1);
  const first = { $id: 'urn:tool:same', type: 'object', properties: { n: { const: 1 } }, required: ['n'] };
  const second = { ...first, properties: { n: { const: 2 } } };
  assert.equal(validator.validate(first, { n: 1 }).ok, true);
  assert.equal(validator.validate(second, { n: 1 }).ok, false);
  assert.equal(validator.validate(second, { n: 2 }).ok, true);
  assert.equal(validator.validate(first, { n: 1 }).ok, true);
  assert.equal(validator.validate({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' }, {}).ok, true);
  assert.throws(() => new JsonSchemaToolValidator(0), RangeError);
});

test('async, invalid and remote-ref schemas fail closed with safe errors', () => {
  const validator = new JsonSchemaToolValidator();
  for (const schema of [{ $async: true, type: 'object' }, { type: 'not-a-type' },
    { $ref: 'https://invalid.example/SECRET' }, { $schema: 'urn:unsupported' }]) {
    assert.deepEqual(validator.validate(schema, { secret: 'PRIVATE_ARGS' }),
      { ok: false, message: 'Tool schema is invalid or unsupported' });
  }
});
