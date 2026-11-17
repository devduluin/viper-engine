import Ajv from 'ajv';
import path from 'node:path';
import { readJson } from '../../scripts/lib/files.mjs';

export function fixtureValidators(root) {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const directory = path.join(root, 'evals/schemas');
  for (const name of ['model-response', 'catalog', 'scenario', 'manifest']) {
    ajv.addSchema(readJson(path.join(directory, `${name}.schema.json`)));
  }
  return {
    catalog: ajv.getSchema('https://viper.local/schemas/catalog.json'),
    scenario: ajv.getSchema('https://viper.local/schemas/scenario.json'),
    modelResponse: ajv.getSchema('https://viper.local/schemas/model-response.json'),
    manifest: ajv.getSchema('https://viper.local/schemas/manifest.json'),
    compile: schema => ajv.compile(schema),
  };
}

export function assertSchema(validator, data, label) {
  if (!validator(data)) throw new Error(`${label}: ${JSON.stringify(validator.errors)}`);
}
