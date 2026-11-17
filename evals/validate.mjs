import { loadFixtures } from './lib/fixtures.mjs';
import { verifyManifest } from './lib/manifest.mjs';

const root = process.cwd();
const { scenarios, catalog } = loadFixtures(root);
verifyManifest(root);
console.log(`Validated ${scenarios.length} scenario definitions; ${catalog.tools.length} tools, ${catalog.resources.length} resource(s), ${catalog.prompts.length} prompt(s).`);
console.log('Definition validation only. Agent execution and V4/Hermes baseline: NOT MEASURED.');
