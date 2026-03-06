import { Effect as E, ParseResult, Schema } from "effect";
import { BaseEntity, type IEntity } from "@domain/utils/base.entity.ts";
import type { Email, HashedPassword, UserId } from "@domain/utils/refined.types.ts";
import {
  StringToEmail,
  StringToHashedPassword,
  StringToUserId,
} from "@domain/utils/refined.types.ts";
import type { Role } from "@domain/utils/enums.ts";
import { Role as RoleEnum } from "@domain/utils/enums.ts";

export const UserSchema = Schema.Struct({
  id: StringToUserId,
  email: StringToEmail,
  passwordHash: StringToHashedPassword,
  role: Schema.Enums(RoleEnum),
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});

export type UserType = Schema.Schema.Type<typeof UserSchema>;

export type SerializedUser = Schema.Schema.Encoded<typeof UserSchema>;

export interface IUser extends IEntity<UserId> {
  readonly email: Email;
  readonly passwordHash: HashedPassword;
  readonly role: Role;
}

export class User extends BaseEntity<UserId> implements IUser {
  readonly email: Email;
  readonly passwordHash: HashedPassword;
  readonly role: Role;

  private constructor(data: UserType) {
    super(data.id, data.createdAt, data.updatedAt);
    this.email = data.email;
    this.passwordHash = data.passwordHash;
    this.role = data.role;
    Object.freeze(this);
  }

  serialized(): E.Effect<SerializedUser, ParseResult.ParseError> {
    return Schema.encode(UserSchema)({
      id: this.id,
      email: this.email,
      passwordHash: this.passwordHash,
      role: this.role,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    });
  }

  /**
   * Returns a new User with the given role and an updated `updatedAt`
   * timestamp.  Only admins should be permitted to call this — enforce
   * that constraint in the workflow layer.
   */
  changeRole(newRole: Role, at: Date): User {
    return User.reconstitute({
      id: this.id,
      email: this.email,
      passwordHash: this.passwordHash,
      role: newRole,
      createdAt: this.createdAt,
      updatedAt: at,
    });
  }

  static create(input: SerializedUser): E.Effect<User, ParseResult.ParseError> {
    return Schema.decodeUnknown(UserSchema)(input).pipe(E.map((data) => new User(data)));
  }

  static reconstitute(data: UserType): User {
    return new User(data);
  }
}
