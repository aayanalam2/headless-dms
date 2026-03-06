import { Effect } from "effect";
import { eq } from "drizzle-orm";
import type { AppDb } from "@infra/database/utils/connection.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import type { Email, UserId } from "@domain/utils/refined.types.ts";
import { User } from "@domain/user/user.entity.ts";
import type { UserRow } from "@infra/database/schema.ts";
import { UserAlreadyExistsError, UserNotFoundError } from "@domain/user/user.errors.ts";
import { RepositoryError } from "@domain/utils/repository.types.ts";
import {
  Email as EmailBrand,
  HashedPassword,
  UserId as UserIdBrand,
} from "@domain/utils/refined.types.ts";

import { usersTable } from "@infra/database/models/user.table.ts";
import {
  executeQuery,
  fetchSingle,
  isUniqueViolation,
} from "@infra/database/utils/query-helpers.ts";

export class DrizzleUserRepository implements IUserRepository {
  constructor(private readonly db: AppDb) {}

  // -------------------------------------------------------------------------
  // Row ↔ entity
  // -------------------------------------------------------------------------

  private static readonly fromRow = (row: UserRow): User => {
    return User.reconstitute({
      id: UserIdBrand.create(row.id).unwrap(),
      email: EmailBrand.create(row.email).unwrap(),
      passwordHash: HashedPassword.create(row.passwordHash).unwrap(),
      role: row.role,
      createdAt: row.createdAt,
    });
  };

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  findById(id: UserId) {
    return fetchSingle(
      () => this.db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1),
      DrizzleUserRepository.fromRow,
    );
  }

  findByEmail(email: Email) {
    return fetchSingle(
      () => this.db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1),
      DrizzleUserRepository.fromRow,
    );
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  save(user: User) {
    return Effect.tryPromise<void, UserAlreadyExistsError | RepositoryError>({
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

  update(user: User) {
    return Effect.flatMap(
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
      (rows) => (rows.length > 0 ? Effect.void : Effect.fail(new UserNotFoundError(user.id))),
    );
  }
}
