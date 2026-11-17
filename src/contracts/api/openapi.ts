import { parseJsonObject } from '../messages/json.js';
import type { JsonValue } from '../messages/json.js';
import { RESOURCE_PATHS } from './resource-paths.js';
import { RUN_PATHS } from './run-paths.js';
import { API_SCHEMA_DOCUMENT } from './schemas.js';

/** Convert only local schema references; preserve arbitrary examples/string data. */
function openApiReferences(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(openApiReferences);
  return Object.fromEntries(Object.entries(value).map(([name, child]) => [name,
    name === '$ref' && typeof child === 'string'
      ? child.replace(/^#\/\$defs\//, '#/components/schemas/')
      : openApiReferences(child),
  ]));
}

/** Exportable document, not a running HTTP service. Endpoint implementation belongs to P06. */
export const OPENAPI_DOCUMENT = parseJsonObject({
  openapi: '3.1.1', jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
  info: { title: 'Viper Engine API', version: '1.0.0', description: 'MCP-first, client-neutral engine contract' },
  servers: [{ url: '/' }],
  security: [{ bearerAuth: [] }],
  paths: { ...RESOURCE_PATHS, ...RUN_PATHS },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    schemas: openApiReferences(API_SCHEMA_DOCUMENT['$defs'] ?? {}),
  },
});
