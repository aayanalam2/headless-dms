/**
 * db.ts — Testcontainers Postgres setup for integration tests.
 *
 * Each test *file* manages one container lifecycle:
 *   - `startTestDb()` in `beforeAll` — starts container, runs migrations, returns { db, sql }.
 *   - `stopTestDb()` in `afterAll`   — tears down the db client and the container.
 *   - `truncateAll()` in `beforeEach` — resets all application tables between tests.
 *
 * Why per-file containers?
 *   Parallel test files get isolated DBs with zero cross-file interference.
 *   Shared containers require careful ordering and are harder to debug.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Wait } from "testcontainers";
import * as schema from "@infra/database/schema.ts";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;
export type TestSql = ReturnType<typeof postgres>;

// ---------------------------------------------------------------------------
// Container lifecycle
// ---------------------------------------------------------------------------

/** Module-level state — mutated by startTestDb / stopTestDb. */
let container: StartedPostgreSqlContainer;
let _sql: TestSql;
let _db: TestDb;

/**
 * Starts a Postgres container, connects, and runs all pending migrations.
 * Call from `beforeAll` in each integration test file.
 */
export async function startTestDb(): Promise<TestDb> {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forHealthCheck())
    .start();

  // Use max:1 for the migration client to avoid connection pool cleanup issues
  const migrationSql = postgres(container.getConnectionUri(), { max: 1 });
  await migrate(drizzle(migrationSql), {
    migrationsFolder: "./src/infra/database/migrations",
  });
  await migrationSql.end();

  _sql = postgres(container.getConnectionUri(), { max: 5 });
  _db = drizzle(_sql, { schema });

  return _db;
}

/**
 * Closes the DB connection and stops the container.
 * Call from `afterAll` in each integration test file.
 */
export async function stopTestDb(): Promise<void> {
  await _sql.end();
  await container.stop();
}

/**
 * Truncates all application tables and restarts identity sequences.
 * Call from `beforeEach` for test isolation.
 *
 * Order matters — FK constraints require child tables to be truncated first
 * (or CASCADE handles it via the shared truncate).
 */
export async function truncateAll(): Promise<void> {
  // CASCADE handles FK ordering automatically
  await _sql`
    TRUNCATE
      access_policies,
      document_versions,
      documents,
      users,
      audit_logs
    RESTART IDENTITY CASCADE
  `;
}
