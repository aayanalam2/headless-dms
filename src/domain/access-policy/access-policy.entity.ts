import { Effect as E, Option as O, ParseResult, Schema } from "effect";
import { BaseEntity, type IEntity } from "@domain/utils/base.entity.ts";
import type { AccessPolicyId, DocumentId, UserId } from "@domain/utils/refined.types.ts";
import {
  StringToAccessPolicyId,
  StringToDocumentId,
  StringToUserId,
} from "@domain/utils/refined.types.ts";
import type { Role } from "@domain/utils/enums.ts";
import { Role as RoleEnum } from "@domain/utils/enums.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { PolicyTargetRequiredError } from "@domain/access-policy/access-policy.errors.ts";

export const AccessPolicySchema = Schema.Struct({
  id: StringToAccessPolicyId,
  documentId: StringToDocumentId,
  subjectId: Schema.OptionFromNullOr(StringToUserId),
  subjectRole: Schema.OptionFromNullOr(Schema.Enums(RoleEnum)),
  action: Schema.Enums(PermissionAction),
  effect: Schema.Enums(PolicyEffect),
  createdAt: Schema.DateFromString,
});

export type AccessPolicyType = Schema.Schema.Type<typeof AccessPolicySchema>;

export type SerializedAccessPolicy = Schema.Schema.Encoded<typeof AccessPolicySchema>;

export interface IAccessPolicy extends IEntity<AccessPolicyId> {
  readonly documentId: DocumentId;
  readonly subjectId: O.Option<UserId>;
  readonly subjectRole: O.Option<Role>;
  readonly action: PermissionAction;
  readonly effect: PolicyEffect;
}

export class AccessPolicy extends BaseEntity<AccessPolicyId> implements IAccessPolicy {
  readonly documentId: DocumentId;
  readonly subjectId: O.Option<UserId>;
  readonly subjectRole: O.Option<Role>;
  readonly action: PermissionAction;
  readonly effect: PolicyEffect;

  private constructor(data: AccessPolicyType) {
    // Policies are immutable — updatedAt always equals createdAt.
    super(data.id, data.createdAt, data.createdAt);
    this.documentId = data.documentId;
    this.subjectId = data.subjectId;
    this.subjectRole = data.subjectRole;
    this.action = data.action;
    this.effect = data.effect;
    Object.freeze(this);
  }

  serialized(): E.Effect<SerializedAccessPolicy, ParseResult.ParseError> {
    return Schema.encode(AccessPolicySchema)({
      id: this.id,
      documentId: this.documentId,
      subjectId: this.subjectId,
      subjectRole: this.subjectRole,
      action: this.action,
      effect: this.effect,
      createdAt: this.createdAt,
    });
  }

  /**
   * Creates a new AccessPolicy from wire / persistence input.
   * Returns `PolicyTargetRequiredError` when neither or both of
   * `subjectId` / `subjectRole` are provided (XOR constraint).
   */
  static create(input: SerializedAccessPolicy): E.Effect<AccessPolicy, PolicyTargetRequiredError> {
    return Schema.decodeUnknown(AccessPolicySchema)(input).pipe(
      E.mapError(() => new PolicyTargetRequiredError()),
      E.flatMap((data) => {
        const hasSubject = O.isSome(data.subjectId);
        const hasRole = O.isSome(data.subjectRole);

        // XOR: exactly one must be set.
        if (hasSubject === hasRole) {
          return E.fail(new PolicyTargetRequiredError());
        }

        return E.succeed(new AccessPolicy(data));
      }),
    );
  }
  static reconstitute(data: AccessPolicyType): AccessPolicy {
    return new AccessPolicy(data);
  }
}
