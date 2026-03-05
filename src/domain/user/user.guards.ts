import type { IUser } from "@domain/user/user.entity";
import { Role } from "@domain/utils/enums.ts";

/**
 * Returns `true` when the user holds the Admin role.
 * Admins bypass all AccessPolicy evaluation.
 */
export function isAdmin(user: IUser): boolean {
  return user.role === Role.Admin;
}

/**
 * Returns `true` when the user holds the regular User role.
 */
export function isRegularUser(user: IUser): boolean {
  return user.role === Role.User;
}
