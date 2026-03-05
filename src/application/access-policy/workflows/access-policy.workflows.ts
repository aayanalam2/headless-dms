import "reflect-metadata";
import { Effect, Option, pipe } from "effect";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@infra/di/tokens.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import type { IAuditRepository } from "@application/audit/audit.repository.port.ts";
import { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import { PolicyTargetRequiredError } from "@domain/access-policy/access-policy.errors.ts";
import { DocumentAccessService } from "@domain/services/document-access.service.ts";
import { isOwner } from "@domain/document/document.guards.ts";
import { Role, AuditAction, AuditResourceType } from "@domain/utils/enums.ts";
import { AccessPolicyId, DocumentId, UserId } from "@domain/utils/refined.types.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  AccessPolicyWorkflowError,
  type AccessPolicyWorkflowError as WorkflowError,
} from "../access-policy-workflow.errors.ts";
import { toAccessPolicyDTO, type AccessPolicyDTO } from "../dtos/access-policy.dto.ts";
import {
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
} from "../dtos/commands.dto.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const unavailable =
  (op: string) =>
  (e: unknown): WorkflowError =>
    AccessPolicyWorkflowError.unavailable(op, e);

const MANAGE_DENIED = AccessPolicyWorkflowError.accessDenied(
  "Only the document owner or an admin can manage access policies",
);

@injectable()
export class AccessPolicyWorkflows {
  constructor(
    @inject(TOKENS.AccessPolicyRepository)
    private readonly policyRepo: IAccessPolicyRepository,
    @inject(TOKENS.DocumentRepository)
    private readonly documentRepo: IDocumentRepository,
    @inject(TOKENS.UserRepository)
    private readonly userRepo: IUserRepository,
    @inject(TOKENS.AuditRepository)
    private readonly auditRepo: IAuditRepository,
  ) {}

  // -------------------------------------------------------------------------
  // grantAccess
  //
  // Creates a new policy for a document.  Exactly one of `subjectId` or
  // `subjectRole` must be provided (enforced by the domain entity).
  // -------------------------------------------------------------------------

  grantAccess(raw: GrantAccessCommandEncoded): Effect.Effect<AccessPolicyDTO, WorkflowError> {
    return pipe(
      decodeCommand(GrantAccessCommandSchema, raw, AccessPolicyWorkflowError.invalidInput),
      Effect.flatMap((cmd) => {
        const actorId = UserId.create(cmd.actor.userId).unwrap();
        const documentId = DocumentId.create(cmd.documentId).unwrap();

        return pipe(
          this.documentRepo.findById(documentId),
          Effect.mapError(unavailable("documentRepo.findById")),
          Effect.flatMap((docOpt) => {
            if (Option.isNone(docOpt)) {
              return Effect.fail(
                AccessPolicyWorkflowError.notFound(`Document '${cmd.documentId}'`),
              );
            }
            const document = docOpt.value;

            if (cmd.actor.role !== Role.Admin && !isOwner(document, actorId)) {
              return Effect.fail<WorkflowError>(MANAGE_DENIED);
            }

            const policyId = AccessPolicyId.create(crypto.randomUUID()).unwrap();
            const result = AccessPolicy.create({
              id: policyId,
              createdAt: new Date(),
              documentId: document.id,
              subjectId: cmd.subjectId ? UserId.create(cmd.subjectId).unwrap() : null,
              subjectRole: cmd.subjectRole ?? null,
              action: cmd.action,
              effect: cmd.effect,
            });

            if (result instanceof PolicyTargetRequiredError) {
              return Effect.fail(AccessPolicyWorkflowError.invalidInput(result.message));
            }

            const policy = result;

            return pipe(
              this.policyRepo.save(policy),
              Effect.mapError(unavailable("policyRepo.save")),
              Effect.flatMap(() =>
                pipe(
                  this.auditRepo.insertAuditLog({
                    actorId: actorId,
                    action: AuditAction.AccessPolicyGrant,
                    resourceType: AuditResourceType.AccessPolicy,
                    resourceId: policy.id,
                    metadata: {
                      documentId: cmd.documentId,
                      action: cmd.action,
                      effect: cmd.effect,
                    },
                  }),
                  Effect.mapError(unavailable("auditRepo.insertAuditLog")),
                  Effect.as(toAccessPolicyDTO(policy)),
                ),
              ),
            );
          }),
        );
      }),
    );
  }

  // -------------------------------------------------------------------------
  // updateAccess
  //
  // Changes the effect (Allow/Deny) of an existing policy.  Because
  // AccessPolicy is immutable, this performs a delete + save with a new ID.
  // Returns the DTO of the replacement policy.
  // -------------------------------------------------------------------------

  updateAccess(raw: UpdateAccessCommandEncoded): Effect.Effect<AccessPolicyDTO, WorkflowError> {
    return pipe(
      decodeCommand(UpdateAccessCommandSchema, raw, AccessPolicyWorkflowError.invalidInput),
      Effect.flatMap((cmd) => {
        const actorId = UserId.create(cmd.actor.userId).unwrap();
        const policyId = AccessPolicyId.create(cmd.policyId).unwrap();

        return pipe(
          this.policyRepo.findById(policyId),
          Effect.mapError(unavailable("policyRepo.findById")),
          Effect.flatMap((policyOpt) => {
            if (Option.isNone(policyOpt)) {
              return Effect.fail(
                AccessPolicyWorkflowError.notFound(`Access policy '${cmd.policyId}'`),
              );
            }
            const existing = policyOpt.value;

            return pipe(
              this.documentRepo.findById(existing.documentId),
              Effect.mapError(unavailable("documentRepo.findById")),
              Effect.flatMap((docOpt) => {
                if (Option.isNone(docOpt)) {
                  return Effect.fail(
                    AccessPolicyWorkflowError.notFound(`Document '${existing.documentId}'`),
                  );
                }
                const document = docOpt.value;

                if (cmd.actor.role !== Role.Admin && !isOwner(document, actorId)) {
                  return Effect.fail<WorkflowError>(MANAGE_DENIED);
                }

                const newId = AccessPolicyId.create(crypto.randomUUID()).unwrap();
                const newPolicy = AccessPolicy.create({
                  id: newId,
                  createdAt: new Date(),
                  documentId: existing.documentId,
                  subjectId: existing.subjectId,
                  subjectRole: existing.subjectRole,
                  action: existing.action,
                  effect: cmd.effect,
                });

                if (newPolicy instanceof PolicyTargetRequiredError) {
                  return Effect.fail(AccessPolicyWorkflowError.invalidInput(newPolicy.message));
                }

                const replacement = newPolicy;

                return pipe(
                  this.policyRepo.delete(policyId),
                  Effect.mapError(unavailable("policyRepo.delete")),
                  Effect.flatMap(() =>
                    pipe(
                      this.policyRepo.save(replacement),
                      Effect.mapError(unavailable("policyRepo.save")),
                      Effect.flatMap(() =>
                        pipe(
                          this.auditRepo.insertAuditLog({
                            actorId: actorId,
                            action: AuditAction.AccessPolicyUpdate,
                            resourceType: AuditResourceType.AccessPolicy,
                            resourceId: replacement.id,
                            metadata: {
                              previousPolicyId: cmd.policyId,
                              documentId: String(existing.documentId),
                              effect: cmd.effect,
                            },
                          }),
                          Effect.mapError(unavailable("auditRepo.insertAuditLog")),
                          Effect.as(toAccessPolicyDTO(replacement)),
                        ),
                      ),
                    ),
                  ),
                );
              }),
            );
          }),
        );
      }),
    );
  }

  // -------------------------------------------------------------------------
  // revokeAccess
  //
  // Permanently removes an access policy.
  // -------------------------------------------------------------------------

  revokeAccess(raw: RevokeAccessCommandEncoded): Effect.Effect<void, WorkflowError> {
    return pipe(
      decodeCommand(RevokeAccessCommandSchema, raw, AccessPolicyWorkflowError.invalidInput),
      Effect.flatMap((cmd) => {
        const actorId = UserId.create(cmd.actor.userId).unwrap();
        const policyId = AccessPolicyId.create(cmd.policyId).unwrap();

        return pipe(
          this.policyRepo.findById(policyId),
          Effect.mapError(unavailable("policyRepo.findById")),
          Effect.flatMap((policyOpt) => {
            if (Option.isNone(policyOpt)) {
              return Effect.fail(
                AccessPolicyWorkflowError.notFound(`Access policy '${cmd.policyId}'`),
              );
            }
            const existing = policyOpt.value;

            return pipe(
              this.documentRepo.findById(existing.documentId),
              Effect.mapError(unavailable("documentRepo.findById")),
              Effect.flatMap((docOpt) => {
                if (Option.isNone(docOpt)) {
                  return Effect.fail(
                    AccessPolicyWorkflowError.notFound(`Document '${existing.documentId}'`),
                  );
                }
                const document = docOpt.value;

                if (cmd.actor.role !== Role.Admin && !isOwner(document, actorId)) {
                  return Effect.fail<WorkflowError>(MANAGE_DENIED);
                }

                return pipe(
                  this.policyRepo.delete(policyId),
                  Effect.mapError(unavailable("policyRepo.delete")),
                  Effect.flatMap(() =>
                    pipe(
                      this.auditRepo.insertAuditLog({
                        actorId: actorId,
                        action: AuditAction.AccessPolicyRevoke,
                        resourceType: AuditResourceType.AccessPolicy,
                        resourceId: policyId,
                        metadata: {
                          documentId: String(existing.documentId),
                          action: existing.action,
                        },
                      }),
                      Effect.mapError(unavailable("auditRepo.insertAuditLog")),
                    ),
                  ),
                );
              }),
            );
          }),
        );
      }),
    );
  }

  // -------------------------------------------------------------------------
  // checkAccess
  //
  // Evaluates whether the requesting actor is permitted to perform `action`
  // on the specified document based on all applicable access policies.
  // Admins are always granted access (short-circuit in DocumentAccessService).
  // -------------------------------------------------------------------------

  checkAccess(raw: CheckAccessQueryEncoded): Effect.Effect<boolean, WorkflowError> {
    return pipe(
      decodeCommand(CheckAccessQuerySchema, raw, AccessPolicyWorkflowError.invalidInput),
      Effect.flatMap((cmd) => {
        const actorId = UserId.create(cmd.actor.userId).unwrap();
        const documentId = DocumentId.create(cmd.documentId).unwrap();

        return pipe(
          Effect.all(
            {
              docOpt: pipe(
                this.documentRepo.findById(documentId),
                Effect.mapError(unavailable("documentRepo.findById")),
              ),
              userOpt: pipe(
                this.userRepo.findById(actorId),
                Effect.mapError(unavailable("userRepo.findById")),
              ),
            },
            { concurrency: 2 },
          ),
          Effect.flatMap(({ docOpt, userOpt }) => {
            if (Option.isNone(docOpt)) {
              return Effect.fail(
                AccessPolicyWorkflowError.notFound(`Document '${cmd.documentId}'`),
              );
            }
            if (Option.isNone(userOpt)) {
              return Effect.fail(AccessPolicyWorkflowError.notFound(`User '${cmd.actor.userId}'`));
            }
            const document = docOpt.value;
            const user = userOpt.value;

            return pipe(
              Effect.all(
                {
                  subjectPolicies: pipe(
                    this.policyRepo.findByDocumentAndSubject(documentId, actorId),
                    Effect.mapError(unavailable("policyRepo.findByDocumentAndSubject")),
                  ),
                  rolePolicies: pipe(
                    this.policyRepo.findByDocumentAndRole(documentId, cmd.actor.role),
                    Effect.mapError(unavailable("policyRepo.findByDocumentAndRole")),
                  ),
                },
                { concurrency: 2 },
              ),
              Effect.map(({ subjectPolicies, rolePolicies }) => {
                const allPolicies = [...subjectPolicies, ...rolePolicies];
                return DocumentAccessService.evaluate(user, allPolicies, document, cmd.action);
              }),
            );
          }),
        );
      }),
    );
  }

  // -------------------------------------------------------------------------
  // listDocumentPolicies
  //
  // Returns all access policies for a document.  Actor must be admin or owner.
  // -------------------------------------------------------------------------

  listDocumentPolicies(
    raw: ListDocumentPoliciesQueryEncoded,
  ): Effect.Effect<readonly AccessPolicyDTO[], WorkflowError> {
    return pipe(
      decodeCommand(ListDocumentPoliciesQuerySchema, raw, AccessPolicyWorkflowError.invalidInput),
      Effect.flatMap((cmd) => {
        const actorId = UserId.create(cmd.actor.userId).unwrap();
        const documentId = DocumentId.create(cmd.documentId).unwrap();

        return pipe(
          this.documentRepo.findById(documentId),
          Effect.mapError(unavailable("documentRepo.findById")),
          Effect.flatMap((docOpt) => {
            if (Option.isNone(docOpt)) {
              return Effect.fail(
                AccessPolicyWorkflowError.notFound(`Document '${cmd.documentId}'`),
              );
            }
            const document = docOpt.value;

            if (cmd.actor.role !== Role.Admin && !isOwner(document, actorId)) {
              return Effect.fail<WorkflowError>(
                AccessPolicyWorkflowError.accessDenied(
                  "Only the document owner or an admin can list access policies",
                ),
              );
            }

            return pipe(
              this.policyRepo.findByDocument(documentId),
              Effect.mapError(unavailable("policyRepo.findByDocument")),
              Effect.map((policies) => policies.map(toAccessPolicyDTO)),
            );
          }),
        );
      }),
    );
  }
}
