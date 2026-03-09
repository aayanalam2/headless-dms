import "reflect-metadata";
import { Effect as E, Schema as S, pipe } from "effect";
import { inject, injectable } from "tsyringe";
import { StringToAccessPolicyId } from "@domain/utils/refined.types.ts";
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
  unavailable,
  requirePolicy,
  buildPolicy,
  emitPolicyGranted,
  emitPolicyUpdated,
  emitPolicyRevoked,
} from "./access-policy.helpers.ts";

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
      decodeCommand(GrantAccessCommandSchema, raw, AccessPolicyWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          this.accessGuard.require(
            cmd.documentId,
            cmd.actor,
            PermissionAction.Share,
            AccessPolicyWorkflowError,
          ),
          E.flatMap(() =>
            buildPolicy(
              {
                id: S.decodeSync(StringToAccessPolicyId)(crypto.randomUUID()),
                createdAt: new Date(),
                documentId: cmd.documentId,
                subjectId: cmd.subjectId,
                action: cmd.action,
                effect: cmd.effect,
              },
              "subjectId must be a valid user ID",
            ),
          ),
          E.flatMap((policy) =>
            pipe(
              this.policyRepo.save(policy),
              E.mapError(unavailable("policyRepo.save")),
              E.flatMap(() =>
                emitPolicyGranted({
                  actorId: cmd.actor.userId,
                  resourceId: policy.id,
                  documentId: cmd.documentId,
                  action: cmd.action,
                  effect: policy.effect,
                }),
              ),
              E.as(toAccessPolicyDTO(policy)),
            ),
          ),
        ),
      ),
    );
  }

  // AccessPolicy is immutable; updating replaces it with a new ID (delete + save).
  updateAccess(raw: UpdateAccessCommandEncoded): E.Effect<AccessPolicyDTO, WorkflowError> {
    return pipe(
      decodeCommand(UpdateAccessCommandSchema, raw, AccessPolicyWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          requirePolicy(this.policyRepo, cmd.policyId),
          E.flatMap((existing) =>
            pipe(
              this.accessGuard.require(
                existing.documentId,
                cmd.actor,
                PermissionAction.Share,
                AccessPolicyWorkflowError,
              ),
              E.flatMap(() =>
                buildPolicy(
                  {
                    id: S.decodeSync(StringToAccessPolicyId)(crypto.randomUUID()),
                    createdAt: new Date(),
                    documentId: existing.documentId,
                    subjectId: existing.subjectId,
                    action: existing.action,
                    effect: cmd.effect,
                  },
                  "Policy reconstruction failed",
                ),
              ),
              E.flatMap((replacement) =>
                pipe(
                  this.policyRepo.delete(cmd.policyId),
                  E.mapError(unavailable("policyRepo.delete")),
                  E.flatMap(() =>
                    pipe(
                      this.policyRepo.save(replacement),
                      E.mapError(unavailable("policyRepo.save")),
                    ),
                  ),
                  E.flatMap(() =>
                    emitPolicyUpdated({
                      actorId: cmd.actor.userId,
                      resourceId: replacement.id,
                      previousPolicyId: cmd.policyId,
                      documentId: existing.documentId,
                      effect: cmd.effect,
                    }),
                  ),
                  E.as(toAccessPolicyDTO(replacement)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  revokeAccess(raw: RevokeAccessCommandEncoded): E.Effect<void, WorkflowError> {
    return pipe(
      decodeCommand(RevokeAccessCommandSchema, raw, AccessPolicyWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          requirePolicy(this.policyRepo, cmd.policyId),
          E.flatMap((existing) =>
            pipe(
              this.accessGuard.require(
                existing.documentId,
                cmd.actor,
                PermissionAction.Share,
                AccessPolicyWorkflowError,
              ),
              E.flatMap(() =>
                pipe(
                  this.policyRepo.delete(cmd.policyId),
                  E.mapError(unavailable("policyRepo.delete")),
                ),
              ),
              E.flatMap(() =>
                emitPolicyRevoked({
                  actorId: cmd.actor.userId,
                  resourceId: cmd.policyId,
                  documentId: existing.documentId,
                  action: existing.action,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  checkAccess(raw: CheckAccessQueryEncoded): E.Effect<boolean, WorkflowError> {
    return pipe(
      decodeCommand(CheckAccessQuerySchema, raw, AccessPolicyWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          this.accessGuard.require(
            cmd.documentId,
            cmd.actor,
            cmd.action,
            AccessPolicyWorkflowError,
          ),
          E.map(() => true),
          E.catchIf(
            (e) => e._tag === AccessPolicyWorkflowErrorTag.AccessDenied,
            () => E.succeed(false),
          ),
        ),
      ),
    );
  }

  listDocumentPolicies(
    raw: ListDocumentPoliciesQueryEncoded,
  ): E.Effect<readonly AccessPolicyDTO[], WorkflowError> {
    return pipe(
      decodeCommand(ListDocumentPoliciesQuerySchema, raw, AccessPolicyWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          this.accessGuard.require(
            cmd.documentId,
            cmd.actor,
            PermissionAction.Share,
            AccessPolicyWorkflowError,
          ),
          E.flatMap(() =>
            pipe(
              this.policyRepo.findByDocument(cmd.documentId),
              E.mapError(unavailable("policyRepo.findByDocument")),
            ),
          ),
          E.map((policies) => policies.map(toAccessPolicyDTO)),
        ),
      ),
    );
  }
}
