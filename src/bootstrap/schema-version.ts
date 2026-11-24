/** Reviewed schema required by this build. Increment alongside every new migration. */
export const ENGINE_SCHEMA_VERSION = 20;

/** A missing suffix is still a contiguous SQL directory; it must not certify an older schema. */
export function assertMigrationVersion(version: number | undefined): void {
  if (version !== ENGINE_SCHEMA_VERSION) throw new Error(`Migration assets do not match this engine build (requires ${ENGINE_SCHEMA_VERSION})`);
}
