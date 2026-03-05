import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@infra/database/schema.ts";

export function createDb(url: string, options?: { max?: number }) {
  const sql = postgres(url, { max: options?.max ?? 10 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

/** Typed Drizzle client — use this as the parameter type for repositories. */
export type AppDb = ReturnType<typeof createDb>["db"];
