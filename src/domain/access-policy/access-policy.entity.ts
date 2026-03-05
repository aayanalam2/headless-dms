import { Option } from "effect";
import {
  BaseEntity,
  type EntityCreateInput,
  type IEntity,
  type SerializedEntity,
} from "@domain/utils/base.entity.ts";
import type { AccessPolicyId, DocumentId, UserId } from "@domain/utils/refined.types.ts";
import { normalizeMaybe, type Maybe } from "@domain/utils/utils.ts";
import type { Role } from "@domain/utils/enums.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { PolicyTargetRequiredError } from "@domain/access-policy/access-policy.errors.ts";


export interface IAccessPolicy extends IEntity<AccessPolicyId> {
  /** The document this policy controls access to. */
  readonly documentId: DocumentId;

  /**
   * When `Some`, this policy applies only to the named user.
   * Mutually exclusive with `subjectRole`.
   */
  readonly subjectId: Option.Option<UserId>;

  /**
   * When `Some`, this policy applies to every user holding this role.
   * Mutually exclusive with `subjectId`.
   */
  readonly subjectRole: Option.Option<Role>;

  /** The operation being granted or denied. */
  readonly action: PermissionAction;

  /** Whether the policy grants or denies the action. */
  readonly effect: PolicyEffect;
}

// ---------------------------------------------------------------------------
// Serialized form
// ---------------------------------------------------------------------------

export type SerializedAccessPolicy = SerializedEntity<AccessPolicyId> & {
  readonly documentId: string;
  /** `null` when the policy is role-based. */
  readonly subjectId: string | null;
  /** `null` when the policy is user-specific. */
  readonly subjectRole: string | null;
  readonly action: string;
  readonly effect: string;
};

// ---------------------------------------------------------------------------
// Factory input
// ---------------------------------------------------------------------------

/**
 * Input for AccessPolicy.create().
 *
 * `subjectId` and `subjectRole` accept `Maybe<T>` so callers can pass
 * `null`, `undefined`, or an existing `Option<T>` without manual conversion.
 * Exactly one must be set; `create()` returns `PolicyTargetRequiredError`
 * when both or neither are provided.
 */
export type CreateAccessPolicyInput = Omit<
  EntityCreateInput<IAccessPolicy>,
  "subjectId" | "subjectRole"
> & {
  readonly subjectId: Maybe<UserId>;
  readonly subjectRole: Maybe<Role>;
};

// ---------------------------------------------------------------------------
// AccessPolicy entity class
// ---------------------------------------------------------------------------

export class AccessPolicy extends BaseEntity<AccessPolicyId> implements IAccessPolicy {
  private constructor(
    id: AccessPolicyId,
    createdAt: Date,
    private readonly data: Omit<IAccessPolicy, keyof IEntity<AccessPolicyId>>,
  ) {
    // Policies are immutable — updatedAt always equals createdAt.
    super(id, createdAt, createdAt);
    Object.freeze(this.data);
  }

  // -------------------------------------------------------------------------
  // IAccessPolicy accessors
  // -------------------------------------------------------------------------

  get documentId(): DocumentId {
    return this.data.documentId;
  }

  get subjectId(): Option.Option<UserId> {
    return this.data.subjectId;
  }

  get subjectRole(): Option.Option<Role> {
    return this.data.subjectRole;
  }

  get action(): PermissionAction {
    return this.data.action;
  }

  get effect(): PolicyEffect {
    return this.data.effect;
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  override _serialize(): SerializedAccessPolicy {
    return {
      ...super._serialize(),
      documentId: this.data.documentId,
      subjectId: Option.getOrNull(this.data.subjectId),
      subjectRole: Option.getOrNull(this.data.subjectRole),
      action: this.data.action,
      effect: this.data.effect,
    };
  }

  static create(input: CreateAccessPolicyInput): AccessPolicy | PolicyTargetRequiredError {
    const subjectId = normalizeMaybe(input.subjectId);
    const subjectRole = normalizeMaybe(input.subjectRole);

    const hasSubject = Option.isSome(subjectId);
    const hasRole = Option.isSome(subjectRole);

    // XOR: exactly one must be set.
    if (hasSubject === hasRole) {
      return new PolicyTargetRequiredError();
    }

    return new AccessPolicy(input.id, input.createdAt, {
      documentId: input.documentId,
      subjectId,
      subjectRole,
      action: input.action,
      effect: input.effect,
    });
  }

  // -------------------------------------------------------------------------
  // Static factory — AccessPolicy.reconstitute (trusted, from persistence)
  // -------------------------------------------------------------------------

  static reconstitute(
    id: AccessPolicyId,
    createdAt: Date,
    props: Omit<IAccessPolicy, keyof IEntity<AccessPolicyId>>,
  ): AccessPolicy {
    return new AccessPolicy(id, createdAt, props);
  }

  // equals() is inherited from BaseEntity — identity by id.
}
