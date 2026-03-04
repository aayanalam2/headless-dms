import { eq } from "drizzle-orm";
import type { Db } from "../db/connection.ts";
import { type NewUserRow, type UserRow, users } from "../db/schema.ts";
import { Effect } from "effect";
import { AppError } from "../../types/errors.ts";
import type { IUserRepository } from "../user.repository.ts";

export function createDrizzleUserRepository(db: Db): IUserRepository {
  return {
    findUserById(id: string): Effect.Effect<UserRow, AppError> {
      return Effect.tryPromise({
        try: () => db.select().from(users).where(eq(users.id, id)).limit(1),
        catch: (e) => AppError.database(e),
      }).pipe(
        Effect.flatMap((rows) =>
          rows[0] ? Effect.succeed(rows[0]) : Effect.fail(AppError.notFound(`User(${id})`)),
        ),
      );
    },

    findUserByEmail(email: string): Effect.Effect<UserRow, AppError> {
      return Effect.tryPromise({
        try: () => db.select().from(users).where(eq(users.email, email)).limit(1),
        catch: (e) => AppError.database(e),
      }).pipe(
        Effect.flatMap((rows) =>
          rows[0]
            ? Effect.succeed(rows[0])
            : Effect.fail(AppError.notFound(`User(email:${email})`)),
        ),
      );
    },

    createUser(data: NewUserRow): Effect.Effect<UserRow, AppError> {
      return Effect.tryPromise({
        try: () => db.insert(users).values(data).returning(),
        catch: (e) => AppError.database(e),
      }).pipe(
        Effect.flatMap((rows) =>
          rows[0]
            ? Effect.succeed(rows[0])
            : Effect.fail(AppError.database("Insert returned no row")),
        ),
      );
    },

    updateUser(id: string, data: Partial<Pick<UserRow, "role">>): Effect.Effect<UserRow, AppError> {
      return Effect.tryPromise({
        try: () => db.update(users).set(data).where(eq(users.id, id)).returning(),
        catch: (e) => AppError.database(e),
      }).pipe(
        Effect.flatMap((rows) =>
          rows[0] ? Effect.succeed(rows[0]) : Effect.fail(AppError.notFound(`User(${id})`)),
        ),
      );
    },
  };
}
