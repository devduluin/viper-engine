import { parseJsonObject } from '../messages/json.js';
import { CONTENT_SCHEMAS } from './content.js';
import { ERROR_SCHEMAS } from './errors.js';
import { EVENT_SCHEMAS } from './events.js';
import { REQUEST_SCHEMAS } from './requests.js';
import { RESPONSE_SCHEMAS } from './responses.js';
import { cursor, key } from './schema.js';
import { MEMORY_SCHEMAS } from './memory.js';

export const API_SCHEMA_ID = 'https://viper.local/schemas/api/v1';

/** One frozen source of truth, also embedded in OpenAPI after local-reference conversion. */
export const API_SCHEMA_DOCUMENT = parseJsonObject({
  $id: API_SCHEMA_ID,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    ...CONTENT_SCHEMAS, ...REQUEST_SCHEMAS, ...RESPONSE_SCHEMAS, ...ERROR_SCHEMAS, ...EVENT_SCHEMAS, ...MEMORY_SCHEMAS,
    IdempotencyKey: key, EventCursor: cursor, PageCursor: cursor,
  },
});
