import {
  BaseEntity,
  type EntityCreateInput,
  type IEntity,
  type SerializedEntity,
} from "@domain/utils/base.entity.ts";
import type { Email, HashedPassword, UserId } from "@domain/utils/refined.types.ts";
import type { Role } from "@domain/utils/enums.ts";

export interface IUser extends IEntity<UserId> {
  readonly email: Email;
  readonly passwordHash: HashedPassword;
  readonly role: Role;
}

// ---------------------------------------------------------------------------
// Serialized form
// ---------------------------------------------------------------------------

export type SerializedUser = SerializedEntity<UserId> & {
  readonly email: string;
  readonly passwordHash: string;
  readonly role: string;
};

// ---------------------------------------------------------------------------
// Factory input
// ---------------------------------------------------------------------------

/**
 * Input for User.create().
 * All fields are already in their final branded/validated domain types —
 * the caller (registration workflow) is responsible for decoding raw input
 * before calling this factory.
 */
export type CreateUserInput = EntityCreateInput<IUser>;

// ---------------------------------------------------------------------------
// User entity class
// ---------------------------------------------------------------------------

export class User extends BaseEntity<UserId> implements IUser {
  private constructor(
    id: UserId,
    createdAt: Date,
    private readonly data: Omit<IUser, keyof IEntity<UserId>>,
  ) {
    // User accounts are immutable — no dedicated updatedAt column.
    super(id, createdAt, createdAt);
    Object.freeze(this.data);
  }

  // -------------------------------------------------------------------------
  // IUser accessors
  // -------------------------------------------------------------------------

  get email(): Email {
    return this.data.email;
  }

  /**
   * The stored password hash (bcrypt / argon2).
   * Never expose this over the wire — use it only for verification.
   */
  get passwordHash(): HashedPassword {
    return this.data.passwordHash;
  }

  get role(): Role {
    return this.data.role;
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  override _serialize(): SerializedUser {
    return {
      ...super._serialize(),
      email: this.data.email,
      passwordHash: this.data.passwordHash,
      role: this.data.role,
    };
  }

  // -------------------------------------------------------------------------
  // Static factory — User.create (primary factory)
  // -------------------------------------------------------------------------

  /**
   * Creates a User from fully-validated, branded inputs.
   *
   * Validation of raw strings (email format, password hashing) is the
   * responsibility of the caller — this factory is intentionally pure and
   * dependency-free.
   */
  static create(input: CreateUserInput): User {
    return new User(input.id, input.createdAt, {
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
    });
  }

  // -------------------------------------------------------------------------
  // Static factory — User.reconstitute (trusted, from persistence)
  // -------------------------------------------------------------------------

  static reconstitute(
    id: UserId,
    createdAt: Date,
    props: Omit<IUser, keyof IEntity<UserId>>,
  ): User {
    return new User(id, createdAt, props);
  }

  // equals() is inherited from BaseEntity — identity by id.
}
