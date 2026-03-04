import type { Effect } from "effect";
import type { NewUserRow, UserRow } from "./db/schema.ts";
import type { AppError } from "../types/errors.ts";

export type IUserRepository = {
  findUserById(id: string): Effect.Effect<UserRow, AppError>;
  findUserByEmail(email: string): Effect.Effect<UserRow, AppError>;
  createUser(data: NewUserRow): Effect.Effect<UserRow, AppError>;
  updateUser(id: string, data: Partial<Pick<UserRow, "role">>): Effect.Effect<UserRow, AppError>;
};
