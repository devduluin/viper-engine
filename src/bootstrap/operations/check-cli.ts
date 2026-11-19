import { createDatabasePool, assertSchemaReady, SchemaNotReadyError } from '../database.js';
import { parseDatabaseConfig } from '../database-config.js';

// Read-only schema/connectivity diagnosis. Deliberately does not inspect model/MCP credentials.
let pool: ReturnType<typeof createDatabasePool> | undefined;
try {
  pool = createDatabasePool(parseDatabaseConfig(process.env));
  const schema = await assertSchemaReady(pool);
  console.log(JSON.stringify({ ready: true, code: 'ready', schema: schema.current }));
} catch (error) {
  const code = error instanceof SchemaNotReadyError ? error.status.problem : 'configuration_or_database_unavailable';
  console.log(JSON.stringify({ ready: false, code }));
  process.exitCode = 1;
} finally { await pool?.end(); }
