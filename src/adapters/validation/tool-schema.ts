import { Ajv2020 } from 'ajv/dist/2020.js';
import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { JsonObject } from '../../contracts/messages/json.js';
import { createFingerprint } from '../../shared/fingerprints/fingerprint.js';

const INVALID_SCHEMA = Object.freeze({ ok: false, message: 'Tool schema is invalid or unsupported' } as const);
const INVALID_ARGS = Object.freeze({ ok: false, message: 'Tool arguments do not match the advertised schema' } as const);

/** Structural ToolArgumentValidator: adapter imports contracts, never agent/application types. */
export class JsonSchemaToolValidator {
  private readonly cache = new Map<string, ValidateFunction | null>();

  constructor(private readonly capacity = 256) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Invalid schema cache capacity');
  }

  validate(schema: JsonObject, args: JsonObject): { readonly ok: true } | { readonly ok: false; readonly message: string } {
    const key = createFingerprint(schema, { domain: 'viper.tool_schema', version: '1' });
    let validator = this.cache.get(key);
    if (validator === undefined) {
      validator = this.compile(schema);
      this.cache.set(key, validator);
      if (this.cache.size > this.capacity) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    if (validator === null) return INVALID_SCHEMA;
    try { return validator(args) ? { ok: true } : INVALID_ARGS; } catch { return INVALID_ARGS; }
  }

  private compile(schema: JsonObject): ValidateFunction | null {
    try {
      if (schema['$async'] !== undefined) return null;
      const dialect = schema['$schema'];
      const legacy = dialect === 'http://json-schema.org/draft-07/schema#' || dialect === 'https://json-schema.org/draft-07/schema';
      const options = { strictSchema: true, strictTypes: false, strictTuples: false, allowUnionTypes: true,
        coerceTypes: false, useDefaults: false, removeAdditional: false, addUsedSchema: false, logger: false as const };
      // Separate compiler per cached schema: $id registries cannot leak across tools or outlive LRU eviction.
      const compiler = legacy ? new Ajv(options) : new Ajv2020(options);
      addFormats.default(compiler, { mode: 'fast' });
      return compiler.compile(schema);
    } catch { return null; } // No remote loader, logger, coercion or provider error reflection.
  }
}
