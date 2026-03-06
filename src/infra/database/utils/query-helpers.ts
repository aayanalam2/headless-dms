import { Effect as E, Option as O } from "effect";
import { RepositoryError } from "@domain/utils/repository.types.ts";

export function executeQuery<T>(query: () => Promise<T>): E.Effect<T, RepositoryError> {
  return E.tryPromise({
    try: query,
    catch: (e) => new RepositoryError("executeQuery", e),
  });
}

export function fetchSingle<TRow, TEntity>(
  query: () => Promise<TRow[]>,
  fromRow: (row: TRow) => TEntity,
): E.Effect<O.Option<TEntity>, RepositoryError> {
  return E.map(executeQuery(query), (rows) =>
    rows[0] ? O.some(fromRow(rows[0])) : O.none<TEntity>(),
  );
}

export function fetchMultiple<TRow, TEntity>(
  query: () => Promise<TRow[]>,
  fromRow: (row: TRow) => TEntity,
): E.Effect<readonly TEntity[], RepositoryError> {
  return E.map(executeQuery(query), (rows) => rows.map(fromRow));
}

// Returns true for Postgres SQLSTATE 23505 (unique constraint violation).
export function isUniqueViolation(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if ("code" in e && (e as { code: string }).code === "23505") return true;
  return e.cause !== undefined && isUniqueViolation(e.cause);
}
