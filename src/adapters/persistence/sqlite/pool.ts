import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import type { SqlConnection, SqlPool, SqlQueryable, SqlResult } from '../postgres/sql-client.js';
import type { Migration, MigrationReport } from '../postgres/migrate.js';
import { recordedMigrations, verifyMigrationSchema } from './schema-ledger.js';
import type { SqliteSchema } from './schema-ledger.js';

export interface SqliteFiles {
  readonly engine: string;
  readonly pro?: string;
}

/** One SQLite connection with exclusive checkout, including reads outside transactions. */
export class SqlitePool implements SqlPool {
  readonly dialect = 'sqlite' as const;
  private readonly db: DatabaseSync;
  private readonly context = new AsyncLocalStorage<object>();
  private tail = Promise.resolve();
  private closing: Promise<void> | undefined;

  constructor(files: SqliteFiles) {
    this.db = new DatabaseSync(':memory:');
    try {
      this.db.function('unicode_lower', { deterministic: true }, value => typeof value === 'string' ? value.toLowerCase() : null);
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON; PRAGMA busy_timeout = 250');
      this.db.prepare('ATTACH DATABASE ? AS viper_engine').run(files.engine);
      this.db.exec('PRAGMA viper_engine.journal_mode = WAL');
      if (files.pro !== undefined) {
        this.db.prepare('ATTACH DATABASE ? AS viper_pro').run(files.pro);
        this.db.exec('PRAGMA viper_pro.journal_mode = WAL');
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  async query(text: string, values: unknown[] = []): Promise<SqlResult> {
    const connection = await this.connect();
    try { return await connection.query(text, values); } finally { connection.release(); }
  }

  async connect(): Promise<SqlConnection> {
    const unlock = await this.reserve();
    let active = true;
    return {
      query: async (text, values = []) => {
        if (!active) throw new Error('SQLite connection has been released');
        return this.execute(text, values);
      },
      release: () => {
        if (!active) return;
        active = false;
        try {
          if (this.db.isTransaction) this.db.exec('ROLLBACK');
        } finally { unlock(); }
      },
    };
  }

  async transaction<T>(work: (tx: SqlQueryable) => Promise<T>): Promise<T> {
    return this.transact(work, false);
  }

  async snapshot<T>(work: (tx: SqlQueryable) => Promise<T>): Promise<T> {
    return this.transact(work, true);
  }

  private async transact<T>(work: (tx: SqlQueryable) => Promise<T>, readOnly: boolean): Promise<T> {
    const connection = await this.connect();
    try {
      if (readOnly) this.db.exec('PRAGMA query_only = ON');
      await connection.query(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
      const result = await this.context.run({}, () => work(connection));
      await connection.query('COMMIT');
      return result;
    } finally {
      try { connection.release(); }
      finally { if (readOnly) this.db.exec('PRAGMA query_only = OFF'); }
    }
  }

  /** Executes a trusted migration script atomically. Never pass tool or user input as SQL. */
  async migrate(sql: string): Promise<void> {
    const unlock = await this.reserve();
    try {
      this.db.exec('BEGIN IMMEDIATE');
      this.db.exec(sql);
      this.db.exec('COMMIT');
    } finally {
      try {
        if (this.db.isTransaction) this.db.exec('ROLLBACK');
      } finally { unlock(); }
    }
  }

  /** Serializes feature schema creation and records its version in the same database transaction. */
  async migrateTo(version: number, sql: string): Promise<void> {
    if (!Number.isSafeInteger(version) || version < 1 || version > 2147483647) throw new RangeError('Invalid SQLite schema version');
    const unlock = await this.reserve();
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const current = this.db.prepare('PRAGMA viper_engine.user_version').get()?.['user_version'];
      if (current !== version) {
        if (current !== version - 1) throw new Error(`Cannot migrate SQLite schema from ${String(current)} to ${version}`);
        this.db.exec(sql);
        this.db.exec(`PRAGMA viper_engine.user_version = ${version}`);
      }
      this.db.exec('COMMIT');
    } finally {
      try { if (this.db.isTransaction) this.db.exec('ROLLBACK'); }
      finally { unlock(); }
    }
  }

  /** Ordered migrations from version 1. DDL and version advancement commit together. */
  async migrationVersion(migrations: readonly Migration[], schema: SqliteSchema = 'viper_engine'): Promise<number> {
    return this.snapshot(async tx => {
      const current = await recordedMigrations(tx, migrations, schema);
      if (current > 0) await verifyMigrationSchema(tx, migrations.slice(0, current), schema);
      return current;
    });
  }

  async migrateSeries(migrations: readonly Migration[], schema: SqliteSchema = 'viper_engine'): Promise<MigrationReport> {
    const unlock = await this.reserve();
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const tx: SqlQueryable = { query: async (sql, values = []) => this.execute(sql, values) };
      const current = await recordedMigrations(tx, migrations, schema);
      if (current > 0) await verifyMigrationSchema(tx, migrations.slice(0, current), schema);
      const pending = migrations.slice(current);
      if (current === 0) this.db.exec(`CREATE TABLE ${schema}.schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL
      ) STRICT`);
      for (const migration of pending) {
        this.db.exec(migration.sql);
        this.db.prepare(`INSERT INTO ${schema}.schema_migrations VALUES (?, ?, ?)`).run(migration.version, migration.name, migration.checksum);
        this.db.exec(`PRAGMA ${schema}.user_version = ${migration.version}`);
      }
      this.db.exec('COMMIT');
      return { applied: pending.map(item => item.version), current: migrations.length };
    } finally {
      try { if (this.db.isTransaction) this.db.exec('ROLLBACK'); }
      finally { unlock(); }
    }
  }

  async end(): Promise<void> {
    this.checkContext();
    this.closing ??= this.tail.then(() => this.db.close());
    await this.closing;
  }

  private async reserve(): Promise<() => void> {
    this.checkContext();
    if (this.closing !== undefined) throw new Error('SQLite pool is closed');
    const previous = this.tail;
    let unlock = () => {};
    this.tail = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    return unlock;
  }

  private checkContext(): void {
    if (this.context.getStore() !== undefined) throw new Error('Use the transaction connection for nested SQLite queries');
  }

  private execute(text: string, values: unknown[]): SqlResult {
    const statement = this.db.prepare(text);
    if (statement.sourceSQL.trim() !== text.trim()) throw new Error('Expected exactly one SQLite statement');
    const parameters = values.map(sqlValue);
    const named = namedBindings(text, parameters);
    if (statement.columns().length === 0) {
      const result = named === undefined ? statement.run(...parameters) : statement.run(named);
      return { rows: [], rowCount: Number(result.changes) };
    }
    const rows = named === undefined ? statement.all(...parameters) : statement.all(named);
    return { rows, rowCount: rows.length };
  }
}

function namedBindings(sql: string, values: SQLInputValue[]): Record<string, SQLInputValue> | undefined {
  // SQLite also accepts native $1-style named parameters, used by portable host queries.
  if (values.length === 0 || !/\$[1-9]\d*/.test(sql)) return undefined;
  return Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]));
}

function sqlValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value;
  if (typeof value === 'boolean') return Number(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('SQLite parameters must be scalar or binary; encode JSON explicitly');
}
