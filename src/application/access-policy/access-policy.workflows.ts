import "reflect-metadata";
import { Effect as E, Option as O, Schema as S, pipe } from "effect";
import { inject, injectable } from "tsyringe";
import { StringToAccessPolicyId } from "@domain/utils/refined.types.ts";
import { TOKENS } from "@infra/di/tokens.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { DocumentAccessService } from "@domain/services/document-access.service.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  AccessPolicyWorkflowError,
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
  requireShareableDocument,
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
    @inject(TOKENS.DocumentRepository)
    private readonly documentRepo: IDocumentRepository,
  ) {}

  grantAccess(raw: GrantAccessCommandEncoded): E.Effect<AccessPolicyDTO, WorkflowError> {
    return pipe(
      decodeCommand(GrantAccessCommandSchema, raw, AccessPolicyWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          requireShareableDocument(this.documentRepo, this.policyRepo, cmd.documentId, cmd.actor),
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
              requireShareableDocument(
                this.documentRepo,
                this.policyRepo,
                existing.documentId,
                cmd.actor,
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
              requireShareableDocument(
                this.documentRepo,
                this.policyRepo,
                existing.documentId,
                cmd.actor,
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
          this.documentRepo.findById(cmd.documentId),
          E.mapError(unavailable("documentRepo.findById")),
          E.flatMap((docOpt) => {
            if (O.isNone(docOpt)) {
              return E.fail(AccessPolicyWorkflowError.notFound(`Document '${cmd.documentId}'`));
            }
            const document = docOpt.value;
            return pipe(
              this.policyRepo.findByDocumentAndSubject(cmd.documentId, cmd.actor.userId),
              E.mapError(unavailable("policyRepo.findByDocumentAndSubject")),
              E.map((policies) =>
                DocumentAccessService.evaluate(
                  { id: cmd.actor.userId, role: cmd.actor.role },
                  policies,
                  document,
                  cmd.action,
                ),
              ),
            );
          }),
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
          requireShareableDocument(this.documentRepo, this.policyRepo, cmd.documentId, cmd.actor),
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
