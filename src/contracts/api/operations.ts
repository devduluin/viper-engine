import { cursor, id, key } from './schema.js';
import type { Schema } from './schema.js';

export function apiRef(name: string): Schema { return { $ref: `#/components/schemas/${name}` }; }
export function parameter(name: string, location: string, schema: Schema, required = false): Schema {
  return { name, in: location, schema, required };
}
export function jsonResponse(schema: string, description: string): Schema {
  return { description, content: { 'application/json': { schema: apiRef(schema) } } };
}
export function jsonBody(schema: string): Schema {
  return { required: true, content: { 'application/json': { schema: apiRef(schema) } } };
}

export function operation(operationId: string, summary: string, response: string, status = 200): Schema {
  return { operationId, summary, responses: {
    [status]: jsonResponse(response, summary),
    default: jsonResponse('ErrorResponse', 'Safe error; stable code determines recovery'),
  } };
}

export const pathId = (name: string) => parameter(name, 'path', id, true);
export const idempotencyKey = parameter('Idempotency-Key', 'header', key, true);
export const pageParameters = [
  parameter('cursor', 'query', cursor),
  parameter('limit', 'query', { type: 'integer', minimum: 1, maximum: 100 }),
];
