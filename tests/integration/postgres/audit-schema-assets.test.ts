import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase, MIGRATIONS_DIR } from './database.js';
import { loadMigrations, migrate } from '../../../src/adapters/persistence/postgres/migrate.js';
import { assertSchemaReady, migrateDatabase } from '../../../src/bootstrap/database.js';

test('truncated migration assets cannot certify an old DB or bootstrap an incomplete schema', async () => {
  const db = await createDatabase({ migrated: false });
  const prefix = path.join(tmpdir(), 'viper-schema-audit-');
  const directory = await mkdtemp(prefix);
  try {
    const migrations = await loadMigrations(MIGRATIONS_DIR);
    await migrate(db.pool, migrations.slice(0, -1));
    for (const migration of migrations.slice(0, -1)) {
      const name = `${String(migration.version).padStart(4, '0')}_${migration.name}.sql`;
      await copyFile(path.join(MIGRATIONS_DIR, name), path.join(directory, name));
    }
    await assert.rejects(assertSchemaReady(db.pool, directory), /Migration assets do not match/);
    await assert.rejects(migrateDatabase(db.pool, directory), /Migration assets do not match/);
  } finally {
    await db.drop();
    if (!path.resolve(directory).startsWith(path.resolve(prefix))) throw new Error('Unexpected temporary directory');
    await rm(directory, { recursive: true, force: true });
  }
});
