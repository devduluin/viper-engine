import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFixtureServer } from './fixture-server.js';
import { engineFixture } from './engine-fixture.js';

// Spawned by contract tests: `node --import tsx stdio-entry.ts [--tools-only]`.
const server = createFixtureServer({
  ...(process.argv.includes('--engine-fixture') ? engineFixture() : {}),
  toolsOnly: process.argv.includes('--tools-only'),
  envProbe: process.argv.includes('--env-probe'),
  crash: () => process.exit(3),
});
await server.connect(new StdioServerTransport());
