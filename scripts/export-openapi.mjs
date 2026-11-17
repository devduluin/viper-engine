import fs from 'node:fs';
import path from 'node:path';
import { OPENAPI_DOCUMENT } from '../dist/contracts/api/openapi.js';

// Reproducible from src/contracts/api/; never edit the exported artifact by hand.
const destination = path.resolve('artifacts/openapi/v1.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(OPENAPI_DOCUMENT, null, 2)}\n`);
console.log(`OpenAPI exported: ${destination}`);
