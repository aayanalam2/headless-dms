import { Effect, Option } from "effect";
import { RepositoryError } from "@domain/utils/repository.types.ts";

// ---------------------------------------------------------------------------
// executeQuery
// Wraps any DB Promise in an Effect, mapping failures to RepositoryError.
// ---------------------------------------------------------------------------
export function executeQuery<T>(query: () => Promise<T>): Effect.Effect<T, RepositoryError> {
  return Effect.tryPromise({
    try: query,
    catch: (e) => new RepositoryError("executeQuery", e),
  });
}

// ---------------------------------------------------------------------------
// fetchSingle
// Runs a query that returns a row array, takes the first row (if any), and
// maps it through `fromRow` to produce Option<TEntity>.
// ---------------------------------------------------------------------------
export function fetchSingle<TRow, TEntity>(
  query: () => Promise<TRow[]>,
  fromRow: (row: TRow) => TEntity,
): Effect.Effect<Option.Option<TEntity>, RepositoryError> {
  return Effect.map(executeQuery(query), (rows) =>
    rows[0] ? Option.some(fromRow(rows[0])) : Option.none<TEntity>(),
  );
}

// ---------------------------------------------------------------------------
// fetchMultiple
// Runs a query that returns a row array and maps every row through `fromRow`.
// ---------------------------------------------------------------------------
export function fetchMultiple<TRow, TEntity>(
  query: () => Promise<TRow[]>,
  fromRow: (row: TRow) => TEntity,
): Effect.Effect<readonly TEntity[], RepositoryError> {
  return Effect.map(executeQuery(query), (rows) => rows.map(fromRow));
}

// ---------------------------------------------------------------------------
// isUniqueViolation
// Returns true for Postgres SQLSTATE 23505 (unique constraint violation).
// ---------------------------------------------------------------------------
export function isUniqueViolation(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if ("code" in e && (e as { code: string }).code === "23505") return true;
  return e.cause !== undefined && isUniqueViolation(e.cause);
}
