import "reflect-metadata";
import { Effect as E, pipe, Schema as S } from "effect";
import { inject, injectable } from "tsyringe";
import { newAccessPolicyId } from "@domain/utils/refined.types.ts";
import { TOKENS } from "@infra/di/tokens.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import { DocumentAccessGuard } from "@application/security/document-access.guard.ts";
import { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  AccessPolicyWorkflowError,
  AccessPolicyWorkflowErrorTag,
  type AccessPolicyWorkflowError as WorkflowError,
} from "./access-policy-workflow.errors.ts";
import {
  toAccessPolicyDTO,
  type AccessPolicyDTO,
  GrantAccessCommandSchema,
  UpdateAccessCommandSchema,
  RevokeAccessCommandSchema,
  CheckAccessQuerySchema,
  ListDocumentPoliciesQuerySchema,
  type GrantAccessCommandEncoded,
  type UpdateAccessCommandEncoded,
  type RevokeAccessCommandEncoded,
  type CheckAccessQueryEncoded,
  type ListDocumentPoliciesQueryEncoded,
} from "./dtos/access-policy.dto.ts";
import {
  liftRepo,
  requirePolicy,
  buildPolicy,
  emitPolicyGranted,
  emitPolicyUpdated,
  emitPolicyRevoked,
} from "./access-policy.helpers.ts";

const decode = <A, I>(schema: S.Schema<A, I>, raw: unknown) =>
  decodeCommand(schema, raw, AccessPolicyWorkflowError.invalidInput);

@injectable()
export class AccessPolicyWorkflows {
  constructor(
    @inject(TOKENS.AccessPolicyRepository)
    private readonly policyRepo: IAccessPolicyRepository,
    @inject(TOKENS.DocumentAccessGuard)
    private readonly accessGuard: DocumentAccessGuard,
  ) {}

  grantAccess(raw: GrantAccessCommandEncoded): E.Effect<AccessPolicyDTO, WorkflowError> {
    return pipe(
      decode(GrantAccessCommandSchema, raw),
      E.flatMap((cmd) =>
        pipe(
          this.accessGuard.require(
            cmd.documentId,
            cmd.actor,
            PermissionAction.Share,
            AccessPolicyWorkflowError,
          ),
          E.flatMap(() =>
            buildPolicy({
              id: newAccessPolicyId(),
              createdAt: new Date(),
              documentId: cmd.documentId,
              subjectId: cmd.subjectId,
              action: cmd.action,
              effect: cmd.effect,
            }),
          ),
          E.tap((policy) => liftRepo(this.policyRepo.save(policy))),
          E.tap((policy) =>
            emitPolicyGranted({
              actorId: cmd.actor.userId,
              resourceId: policy.id,
              documentId: cmd.documentId,
              action: cmd.action,
              effect: policy.effect,
            }),
          ),
          E.map(toAccessPolicyDTO),
        ),
      ),
    );
  }

  // AccessPolicy is immutable; updating replaces it with a new ID (delete + save).
  updateAccess(raw: UpdateAccessCommandEncoded): E.Effect<AccessPolicyDTO, WorkflowError> {
    return pipe(
      decode(UpdateAccessCommandSchema, raw),
      E.flatMap((cmd) =>
        pipe(
          requirePolicy(this.policyRepo, cmd.policyId),
          E.flatMap((existing) =>
            E.as(
              this.accessGuard.require(
                existing.documentId,
                cmd.actor,
                PermissionAction.Share,
                AccessPolicyWorkflowError,
              ),
              existing,
            ),
          ),
          E.flatMap((existing) =>
            E.map(
              buildPolicy({
                id: newAccessPolicyId(),
                createdAt: new Date(),
                documentId: existing.documentId,
                subjectId: existing.subjectId,
                action: existing.action,
                effect: cmd.effect,
              }),
              (replacement) => ({ existing, replacement }),
            ),
          ),
          E.tap(({ replacement }) =>
            pipe(
              liftRepo(this.policyRepo.delete(cmd.policyId)),
              E.flatMap(() => liftRepo(this.policyRepo.save(replacement))),
            ),
          ),
          E.tap(({ existing, replacement }) =>
            emitPolicyUpdated({
              actorId: cmd.actor.userId,
              resourceId: replacement.id,
              previousPolicyId: cmd.policyId,
              documentId: existing.documentId,
              effect: cmd.effect,
            }),
          ),
          E.map(({ replacement }) => toAccessPolicyDTO(replacement)),
        ),
      ),
    );
  }

  revokeAccess(raw: RevokeAccessCommandEncoded): E.Effect<void, WorkflowError> {
    return pipe(
      decode(RevokeAccessCommandSchema, raw),
      E.flatMap((cmd) =>
        pipe(
          requirePolicy(this.policyRepo, cmd.policyId),
          E.flatMap((existing) =>
            E.as(
              this.accessGuard.require(
                existing.documentId,
                cmd.actor,
                PermissionAction.Share,
                AccessPolicyWorkflowError,
              ),
              existing,
            ),
          ),
          E.tap(() => liftRepo(this.policyRepo.delete(cmd.policyId))),
          E.flatMap((existing) =>
            emitPolicyRevoked({
              actorId: cmd.actor.userId,
              resourceId: cmd.policyId,
              documentId: existing.documentId,
              action: existing.action,
            }),
          ),
        ),
      ),
    );
  }

  checkAccess(raw: CheckAccessQueryEncoded): E.Effect<boolean, WorkflowError> {
    return pipe(
      decode(CheckAccessQuerySchema, raw),
      E.flatMap((cmd) =>
        this.accessGuard.require(cmd.documentId, cmd.actor, cmd.action, AccessPolicyWorkflowError),
      ),
      E.map(() => true),
      E.catchIf(
        (e) => e._tag === AccessPolicyWorkflowErrorTag.AccessDenied,
        () => E.succeed(false),
      ),
    );
  }

  listDocumentPolicies(
    raw: ListDocumentPoliciesQueryEncoded,
  ): E.Effect<readonly AccessPolicyDTO[], WorkflowError> {
    return pipe(
      decode(ListDocumentPoliciesQuerySchema, raw),
      E.flatMap((cmd) =>
        pipe(
          this.accessGuard.require(
            cmd.documentId,
            cmd.actor,
            PermissionAction.Share,
            AccessPolicyWorkflowError,
          ),
          E.flatMap(() => liftRepo(this.policyRepo.findByDocument(cmd.documentId))),
          E.map((policies) => policies.map(toAccessPolicyDTO)),
        ),
      ),
    );
  }
}
