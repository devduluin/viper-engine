import { Ajv2020 } from 'ajv/dist/2020.js';
import { API_SCHEMA_DOCUMENT, API_SCHEMA_ID } from '../../contracts/api/schemas.js';
import { ApiFailure } from '../../contracts/api/failure.js';
import { parseJsonObject } from '../../contracts/messages/json.js';
import type { JsonObject } from '../../contracts/messages/json.js';

export function apiValidation() {
  const ajv = new Ajv2020({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false, logger: false });
  ajv.addSchema(API_SCHEMA_DOCUMENT);
  let lastErrors: readonly { instancePath: string; keyword: string }[] = [];
  const validate = (name: string, value: unknown): boolean => {
    const compiled = ajv.getSchema(`${API_SCHEMA_ID}#/$defs/${name}`);
    if (compiled === undefined) throw new Error('Unknown API schema');
    const ok = compiled(value) === true;
    lastErrors = ok ? [] : (compiled.errors ?? []).slice(0, 5);
    return ok;
  };
  return {
    request(name: string, value: unknown): JsonObject {
      let body: JsonObject;
      try { body = parseJsonObject(value); } catch { throw new ApiFailure('INVALID_REQUEST'); }
      if (!validate(name, body)) throw new ApiFailure('INVALID_REQUEST');
      const input = body['input'];
      if (input !== undefined && Buffer.byteLength(JSON.stringify(input)) > 262144) throw new ApiFailure('PAYLOAD_TOO_LARGE');
      return body;
    },
    response(name: string, value: unknown): JsonObject {
      if (!validate(name, value)) {
        // Our own response broke its contract: say where (paths and keywords only, never values that may hold user data).
        console.error(JSON.stringify({ event: 'viper_engine_invalid_response', schema: name,
          errors: lastErrors.map(error => `${error.instancePath || '/'} ${error.keyword}`) }));
        throw new ApiFailure('INTERNAL_ERROR');
      }
      return parseJsonObject(value);
    },
  };
}
