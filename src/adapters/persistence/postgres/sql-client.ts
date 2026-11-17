/**
 * Minimal SQL surface the repositories need. `pg.Pool`/`pg.PoolClient` satisfy it structurally,
 * so repositories never import the driver and tests can use any compatible pool.
 */
export interface SqlResult {
  readonly rows: readonly unknown[];
  readonly rowCount: number | null;
}

export interface SqlQueryable {
  query(text: string, values?: unknown[]): Promise<SqlResult>;
}

export interface SqlConnection extends SqlQueryable {
  release(error?: Error | boolean): void;
}

export interface SqlPool extends SqlQueryable {
  /** Internal composition seam: repositories can share their caller's transaction. */
  transaction?<T>(work: (tx: SqlQueryable) => Promise<T>): Promise<T>;
  connect(): Promise<SqlConnection>;
}

/** Runs `work` in one READ COMMITTED transaction; any throw rolls back and is rethrown. */
export async function withTransaction<T>(pool: SqlPool, work: (tx: SqlQueryable) => Promise<T>): Promise<T> {
  if (pool.transaction !== undefined) return pool.transaction(work);
  const connection = await pool.connect();
  let broken = false;
  try {
    await connection.query('BEGIN');
    const result = await work(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await connection.query('ROLLBACK');
    } catch {
      broken = true; // A connection that cannot roll back must not return to the pool.
    }
    throw error;
  } finally {
    connection.release(broken);
  }
}

/**
 * Read-only REPEATABLE READ transaction: every query sees the same snapshot, so a checkpoint's
 * run, history, ledger and event cursor are mutually consistent even under concurrent writes.
 */
export async function withSnapshot<T>(pool: SqlPool, work: (tx: SqlQueryable) => Promise<T>): Promise<T> {
  if (pool.transaction !== undefined) return pool.transaction(work);
  const connection = await pool.connect();
  let broken = false;
  try {
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await work(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => { broken = true; });
    throw error;
  } finally {
    connection.release(broken);
  }
}

/** PostgreSQL SQLSTATE of a driver error, without depending on the driver's classes. */
export function sqlState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

/** Constraint (or unique index) name of a driver error; repositories map only named ones. */
export function sqlConstraint(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const name = Reflect.get(error, 'constraint');
  return typeof name === 'string' ? name : undefined;
}

export const SQLSTATE = Object.freeze({
  foreignKeyViolation: '23503',
  uniqueViolation: '23505',
});
