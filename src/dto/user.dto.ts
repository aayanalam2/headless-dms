import type { UserRow } from "../models/db/schema.ts";
import { ISODateString } from "../types/branded.ts";
import { Role } from "../types/enums.ts";

// ---------------------------------------------------------------------------
// User DTO — the outbound shape for user data.
// password_hash is deliberately omitted; it must never leave the server.
// ---------------------------------------------------------------------------

export type UserDTO = {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
  readonly createdAt: ISODateString;
};

export function toUserDTO(row: UserRow): UserDTO {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: ISODateString.fromDate(row.createdAt),
  };
}
