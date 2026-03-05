import { pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { SharedColumns } from "@infra/database/utils/shared-columns.ts";
import { roleEnum } from "./enums.ts";
import type { Role } from "@domain/utils/enums.ts";

// ---------------------------------------------------------------------------
// users table
// ---------------------------------------------------------------------------
export const usersTable = pgTable(
  "users",
  {
    ...SharedColumns,
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().$type<Role>(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);
export type UserRow = typeof usersTable.$inferSelect;
export type NewUserRow = typeof usersTable.$inferInsert;
