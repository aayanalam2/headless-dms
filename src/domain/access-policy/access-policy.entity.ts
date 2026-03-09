import { Effect as E, ParseResult, Schema } from "effect";
import { BaseEntity, type IEntity } from "@domain/utils/base.entity.ts";
import type { AccessPolicyId, DocumentId, UserId } from "@domain/utils/refined.types.ts";
import {
  StringToAccessPolicyId,
  StringToDocumentId,
  StringToUserId,
} from "@domain/utils/refined.types.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";

export const AccessPolicySchema = Schema.Struct({
  id: StringToAccessPolicyId,
  documentId: StringToDocumentId,
  subjectId: StringToUserId,
  action: Schema.Enums(PermissionAction),
  effect: Schema.Enums(PolicyEffect),
  createdAt: Schema.DateFromString,
});

export type AccessPolicyType = Schema.Schema.Type<typeof AccessPolicySchema>;

export type SerializedAccessPolicy = Schema.Schema.Encoded<typeof AccessPolicySchema>;

export interface IAccessPolicy extends IEntity<AccessPolicyId> {
  readonly documentId: DocumentId;
  readonly subjectId: UserId;
  readonly action: PermissionAction;
  readonly effect: PolicyEffect;
}

export class AccessPolicy extends BaseEntity<AccessPolicyId> implements IAccessPolicy {
  readonly documentId: DocumentId;
  readonly subjectId: UserId;
  readonly action: PermissionAction;
  readonly effect: PolicyEffect;

  private constructor(data: AccessPolicyType) {
    // Policies are immutable — updatedAt always equals createdAt.
    super(data.id, data.createdAt, data.createdAt);
    this.documentId = data.documentId;
    this.subjectId = data.subjectId;
    this.action = data.action;
    this.effect = data.effect;
    Object.freeze(this);
  }

  serialized(): E.Effect<SerializedAccessPolicy, ParseResult.ParseError> {
    return Schema.encode(AccessPolicySchema)({
      id: this.id,
      documentId: this.documentId,
      subjectId: this.subjectId,
      action: this.action,
      effect: this.effect,
      createdAt: this.createdAt,
    });
  }

  /**
   * Creates a new AccessPolicy from wire / persistence input.
   * Fails with a `ParseResult.ParseError` if any field is invalid.
   */
  static create(input: SerializedAccessPolicy): E.Effect<AccessPolicy, ParseResult.ParseError> {
    return Schema.decodeUnknown(AccessPolicySchema)(input).pipe(
      E.map((data) => new AccessPolicy(data)),
    );
  }

  static reconstitute(data: AccessPolicyType): AccessPolicy {
    return new AccessPolicy(data);
  }
}
