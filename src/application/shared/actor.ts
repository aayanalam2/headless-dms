import { Schema as S } from "effect";
import { Role as RoleEnum } from "@domain/utils/enums.ts";
import type { Role } from "@domain/utils/enums.ts";
import type { UserId } from "@domain/utils/refined.types.ts";
import { UserSchema } from "@domain/user/user.entity.ts";

export type Actor = {
  readonly userId: UserId;
  readonly role: Role;
};

export const ActorCommandSchema = S.Struct({
  userId: UserSchema.fields.id,
  role: S.Enums(RoleEnum),
});
export type ActorCommandEncoded = S.Schema.Encoded<typeof ActorCommandSchema>;
export type ActorCommand = S.Schema.Type<typeof ActorCommandSchema>;
