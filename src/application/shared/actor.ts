import { Schema as S } from "effect";
import { Role as RoleEnum } from "@domain/utils/enums.ts";
import type { Role } from "@domain/utils/enums.ts";
import type { UserId, DocumentId } from "@domain/utils/refined.types.ts";
import { UserSchema } from "@domain/user/user.entity.ts";

export type Actor = {
  readonly userId: UserId;
  readonly role: Role;
};

/** Cross-domain constraint for any context that carries a documentId + actor. */
export type DocumentActorCtx = {
  readonly documentId: DocumentId;
  readonly actor: Actor;
};

export const ActorCommandSchema = S.Struct({
  userId: UserSchema.fields.id,
  role: S.Enums(RoleEnum),
});
export type ActorCommandEncoded = S.Schema.Encoded<typeof ActorCommandSchema>;
export type ActorCommand = S.Schema.Type<typeof ActorCommandSchema>;
