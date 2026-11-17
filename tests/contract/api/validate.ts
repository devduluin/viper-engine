import { Ajv2020 } from 'ajv/dist/2020.js';
import { API_SCHEMA_DOCUMENT, API_SCHEMA_ID } from '../../../src/contracts/api/schemas.js';

export const validator = new Ajv2020({ strict: true, allErrors: true });
validator.addSchema(API_SCHEMA_DOCUMENT);

export function validates(name: string, value: unknown): boolean {
  const validate = validator.getSchema(`${API_SCHEMA_ID}#/$defs/${name}`);
  if (validate === undefined) throw new Error(`Missing API schema: ${name}`);
  return validate(value) === true;
}

export function assertValid(name: string, value: unknown): void {
  const validate = validator.getSchema(`${API_SCHEMA_ID}#/$defs/${name}`);
  if (validate === undefined || !validate(value)) {
    throw new Error(`${name}: ${JSON.stringify(validate?.errors)}`);
  }
}
