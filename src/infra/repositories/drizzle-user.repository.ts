import { Effect as E, Option as O, Schema as S } from "effect";
import { eq } from "drizzle-orm";
import type { AppDb } from "@infra/database/utils/connection.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import type { Email, UserId } from "@domain/utils/refined.types.ts";
import { User } from "@domain/user/user.entity.ts";
import type { UserRow } from "@infra/database/schema.ts";
import { UserAlreadyExistsError, UserNotFoundError } from "@domain/user/user.errors.ts";
import { RepositoryError, type RepositoryEffect } from "@domain/utils/repository.types.ts";
import {
  StringToUserId,
  StringToEmail,
  StringToHashedPassword,
} from "@domain/utils/refined.types.ts";

import { usersTable } from "@infra/database/models/user.table.ts";
import {
  executeQuery,
  fetchSingle,
  isUniqueViolation,
} from "@infra/database/utils/query-helpers.ts";

export class DrizzleUserRepository implements IUserRepository {
  constructor(private readonly db: AppDb) {}

  private static readonly fromRow = (row: UserRow): User => {
    return User.reconstitute({
      id: S.decodeSync(StringToUserId)(row.id),
      email: S.decodeSync(StringToEmail)(row.email),
      passwordHash: S.decodeSync(StringToHashedPassword)(row.passwordHash),
      role: row.role,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  };

  findById(id: UserId): RepositoryEffect<O.Option<User>> {
    return fetchSingle(
      () => this.db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1),
      DrizzleUserRepository.fromRow,
    );
  }

  findByEmail(email: Email): RepositoryEffect<O.Option<User>> {
    return fetchSingle(
      () => this.db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1),
      DrizzleUserRepository.fromRow,
    );
  }

  save(user: User): RepositoryEffect<void, UserAlreadyExistsError> {
    return E.tryPromise<void, UserAlreadyExistsError | RepositoryError>({
      try: async () => {
        await this.db.insert(usersTable).values({
          id: user.id,
          email: user.email,
          passwordHash: user.passwordHash,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        });
      },
      catch: (e) =>
        isUniqueViolation(e)
          ? new UserAlreadyExistsError(user.email)
          : new RepositoryError("user.save", e),
    });
  }

  update(user: User): RepositoryEffect<void, UserNotFoundError> {
    return E.flatMap(
      executeQuery(() =>
        this.db
          .update(usersTable)
          .set({
            email: user.email,
            passwordHash: user.passwordHash,
            role: user.role,
            updatedAt: user.updatedAt,
          })
          .where(eq(usersTable.id, user.id))
          .returning({ id: usersTable.id }),
      ),
      (rows) => (rows.length > 0 ? E.void : E.fail(new UserNotFoundError(user.id))),
    );
  }
}
