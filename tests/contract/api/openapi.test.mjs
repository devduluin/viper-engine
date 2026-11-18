import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { OPENAPI_DOCUMENT } from '../../../src/contracts/api/openapi.ts';
import { API_SCHEMA_DOCUMENT, API_SCHEMA_ID } from '../../../src/contracts/api/schemas.ts';
import { requestFixtures, responseFixtures } from './fixtures.ts';

const fixturePath = new URL('../../fixtures/api/openapi-3.1-2025-11-23.json', import.meta.url);
const expectedHash = '1b8ccc6e34234b17536f2dd0eb3597142a32bd108438cd42471a5fca4c1a07ef';

function officialStructure(bytes) {
  const source = bytes.toString('utf8');
  const original = JSON.parse(source);
  // Ajv 8.17.1 resolves a non-root dynamic-anchor fallback to the calling schema.
  // This non-extended structural validation has one fixed #meta target; use its static equivalent.
  const serialized = JSON.stringify(original);
  assert.equal(serialized.split('"$dynamicRef":"#meta"').length - 1, 4);
  return JSON.parse(serialized.replaceAll('"$dynamicRef":"#meta"', '"$ref":"#/$defs/schema"'));
}

function references(value) {
  if (value === null || typeof value !== 'object') return [];
  return [...(typeof value.$ref === 'string' ? [value.$ref] : []), ...Object.values(value).flatMap(references)];
}

test('OpenAPI structure validates with a pinned official offline schema', () => {
  const bytes = fs.readFileSync(fixturePath);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
  const official = officialStructure(bytes);
  // The official structural schema contains format annotations and is not a payload validator.
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
  const validate = ajv.compile(official);
  assert.equal(validate(OPENAPI_DOCUMENT), true, JSON.stringify(validate.errors?.slice(0, 3)));
  const broken = structuredClone(OPENAPI_DOCUMENT);
  broken.paths['/api/v1/runs/{runId}'].get.responses = 'invalid';
  assert.equal(validate(broken), false, 'invalid operation response must fail official schema');
});

test('all named payload schemas compile strictly and OpenAPI references resolve locally', () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addSchema(API_SCHEMA_DOCUMENT);
  for (const name of Object.keys(API_SCHEMA_DOCUMENT.$defs)) {
    assert.equal(typeof ajv.getSchema(`${API_SCHEMA_ID}#/$defs/${name}`), 'function', name);
  }
  for (const reference of references(OPENAPI_DOCUMENT)) {
    assert.ok(reference.startsWith('#/components/schemas/'), reference);
    assert.ok(Object.hasOwn(OPENAPI_DOCUMENT.components.schemas, reference.split('/').at(-1)), reference);
  }
  assert.equal(Object.isFrozen(OPENAPI_DOCUMENT.components.schemas), true);
});

test('exported OpenAPI payloads validate the same fixtures as the standalone JSON schema', () => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  ajv.addSchema(OPENAPI_DOCUMENT, 'openapi');
  for (const [name, value] of Object.entries({ ...requestFixtures, ...responseFixtures })) {
    const validate = ajv.getSchema(`openapi#/components/schemas/${name}`);
    assert.ok(validate);
    assert.equal(validate(value), true, `${name}: ${JSON.stringify(validate.errors)}`);
  }
});

test('fourteen operations inherit auth, use exact contracts and expose no desktop/legacy routes', () => {
  const paths = OPENAPI_DOCUMENT.paths;
  const operations = Object.values(paths).flatMap(path => Object.values(path));
  assert.equal(Object.keys(paths).length, 12);
  assert.equal(operations.length, 14);
  assert.equal(new Set(operations.map(operation => operation.operationId)).size, 14);
  assert.deepEqual(OPENAPI_DOCUMENT.security, [{ bearerAuth: [] }]);
  for (const [path, item] of Object.entries(paths)) {
    assert.ok(path.startsWith('/api/v1/'));
    assert.doesNotMatch(path, /desktop|device|pair|knowledge|skill|intent/);
    for (const operation of Object.values(item)) {
      assert.ok(operation.responses && Object.keys(operation.responses).length > 0);
      assert.equal(operation.security, undefined, 'inherit authenticated server scope');
      for (const match of path.matchAll(/\{([^}]+)\}/g)) {
        assert.ok(operation.parameters.some(parameter => parameter.name === match[1] && parameter.in === 'path' && parameter.required));
      }
    }
  }
  const start = paths['/api/v1/conversations/{conversationId}/runs'].post;
  assert.ok(start.responses['202']);
  assert.ok(start.parameters.find(parameter => parameter.name === 'Idempotency-Key').required);
  const events = paths['/api/v1/runs/{runId}/events'].get;
  assert.ok(events.responses['410']);
  assert.ok(events.responses['200'].content['text/event-stream']);
  assert.ok(events.parameters.find(parameter => parameter.name === 'Last-Event-ID'));
});

test('dedup keys and cursor tokens are bounded and have separate semantic contracts', () => {
  const ajv = new Ajv2020({ strict: true });
  ajv.addSchema(API_SCHEMA_DOCUMENT);
  const key = ajv.getSchema(`${API_SCHEMA_ID}#/$defs/IdempotencyKey`);
  const cursor = ajv.getSchema(`${API_SCHEMA_ID}#/$defs/EventCursor`);
  assert.equal(key('request-42:retry'), true);
  assert.equal(key('x'.repeat(129)), false);
  assert.equal(key('unsafe\r\nheader'), false);
  assert.equal(cursor('opaque_cursor-42'), true);
  assert.equal(cursor('bearer token'), false);
  assert.equal(cursor('x'.repeat(2049)), false);
});
