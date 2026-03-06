import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "@infra/database/schema.ts";

/** Typed Drizzle client — use this as the parameter type for repositories. */
export type AppDb = PostgresJsDatabase<typeof schema>;

export function createDb(url: string, options?: { max?: number }): { db: AppDb; sql: Sql } {
  const sql = postgres(url, { max: options?.max ?? 10 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}
