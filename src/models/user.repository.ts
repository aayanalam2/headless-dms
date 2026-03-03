import { eq } from "drizzle-orm";
import { db } from "./db/connection.ts";
import { type NewUserRow, type UserRow, users } from "./db/schema.ts";
import { AppError, type AppResult, Result } from "../types/errors.ts";

// ---------------------------------------------------------------------------
// User repository — all database access for the users table.
// Functions return AppResult<T>; DB errors are caught and surfaced as
// AppError.database so callers never deal with raw exceptions.
// ---------------------------------------------------------------------------

export async function findUserById(id: string): Promise<AppResult<UserRow>> {
  try {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    const row = rows[0];
    if (!row) return Result.Err(AppError.notFound(`User(${id})`));
    return Result.Ok(row);
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}

export async function findUserByEmail(
  email: string,
): Promise<AppResult<UserRow>> {
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const row = rows[0];
    if (!row) return Result.Err(AppError.notFound(`User(email:${email})`));
    return Result.Ok(row);
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}

export async function createUser(
  data: NewUserRow,
): Promise<AppResult<UserRow>> {
  try {
    const rows = await db.insert(users).values(data).returning();
    const row = rows[0];
    if (!row) return Result.Err(AppError.database("Insert returned no row"));
    return Result.Ok(row);
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}

export async function updateUser(
  id: string,
  data: Partial<Pick<UserRow, "role">>,
): Promise<AppResult<UserRow>> {
  try {
    const rows = await db
      .update(users)
      .set(data)
      .where(eq(users.id, id))
      .returning();
    const row = rows[0];
    if (!row) return Result.Err(AppError.notFound(`User(${id})`));
    return Result.Ok(row);
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}
