import { createDatabasePool, migrateDatabase } from './database.js';
import { parseDatabaseConfig } from './database-config.js';

// `npm run db:migrate`: applies pending engine migrations to the database in VIPER_DB_*.
// Prints only host/database/versions; never credentials.
const config = parseDatabaseConfig(process.env);
const pool = createDatabasePool(config);
try {
  const report = await migrateDatabase(pool);
  console.log(`viper_engine @ ${config.host}:${config.port}/${config.database}: applied [${report.applied.join(', ')}], current ${report.current}`);
} finally {
  await pool.end();
}
