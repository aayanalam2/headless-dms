import type { UserRow } from "../models/db/schema.ts";

// ---------------------------------------------------------------------------
// User DTO — the outbound shape for user data.
// password_hash is deliberately omitted; it must never leave the server.
// ---------------------------------------------------------------------------

export type UserDTO = {
  readonly id: string;
  readonly email: string;
  readonly role: "admin" | "user";
  readonly createdAt: string; // ISO-8601
};

// ---------------------------------------------------------------------------
// toUserDTO
// Pure function: strips sensitive fields and normalises dates to ISO strings.
// ---------------------------------------------------------------------------

export function toUserDTO(row: UserRow): UserDTO {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}
