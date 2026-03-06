import "reflect-metadata";
import { Effect, Option, pipe } from "effect";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@infra/di/tokens.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import type { AccessPolicy as AccessPolicyType } from "@domain/access-policy/access-policy.entity.ts";
import type { Document } from "@domain/document/document.entity.ts";
import { DocumentAccessService } from "@domain/services/document-access.service.ts";
import { isOwner } from "@domain/document/document.guards.ts";
import { Role } from "@domain/utils/enums.ts";
import type { UserId, AccessPolicyId, DocumentId } from "@domain/utils/refined.types.ts";
import {
  AccessPolicyEvent,
  type AccessPolicyGrantedEvent,
  type AccessPolicyUpdatedEvent,
  type AccessPolicyRevokedEvent,
} from "@domain/events/access-policy.events.ts";
import { eventBus } from "@infra/event-bus.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  AccessPolicyWorkflowError,
  type AccessPolicyWorkflowError as WorkflowError,
} from "./access-policy-workflow.errors.ts";
import { toAccessPolicyDTO, type AccessPolicyDTO } from "./dtos/access-policy.dto.ts";
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
} from "./dtos/commands.dto.ts";

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

const unavailable =
  (op: string) =>
  (e: unknown): WorkflowError =>
    AccessPolicyWorkflowError.unavailable(op, e);

const MANAGE_DENIED = AccessPolicyWorkflowError.accessDenied(
  "Only the document owner or an admin can manage access policies",
);

/** Fetches a document by ID; maps absence to a notFound workflow error. */
function requireDocForPolicy(
  repo: IDocumentRepository,
  documentId: DocumentId,
): Effect.Effect<Document, WorkflowError> {
  return pipe(
    repo.findById(documentId),
    Effect.mapError(unavailable("documentRepo.findById")),
    Effect.flatMap((opt) =>
      Option.isNone(opt)
        ? Effect.fail(AccessPolicyWorkflowError.notFound(`Document '${documentId}'`))
        : Effect.succeed(opt.value),
    ),
  );
}

/** Fetches a policy by ID; maps absence to a notFound workflow error. */
function requirePolicy(
  repo: IAccessPolicyRepository,
  policyId: AccessPolicyId,
): Effect.Effect<AccessPolicyType, WorkflowError> {
  return pipe(
    repo.findById(policyId),
    Effect.mapError(unavailable("policyRepo.findById")),
    Effect.flatMap((opt) =>
      Option.isNone(opt)
        ? Effect.fail(AccessPolicyWorkflowError.notFound(`Access policy '${policyId}'`))
        : Effect.succeed(opt.value),
    ),
  );
}

/**
 * Guards that the actor is the document owner or an admin.
 * Returns the document so it stays in scope for callers that need it.
 */
function assertPolicyManager(
  document: Document,
  actor: { readonly userId: UserId; readonly role: Role },
): Effect.Effect<Document, WorkflowError> {
  return actor.role !== Role.Admin && !isOwner(document, actor.userId)
    ? Effect.fail(MANAGE_DENIED)
    : Effect.succeed(document);
}

const emitPolicyGranted = (event: AccessPolicyGrantedEvent): Effect.Effect<void, never> =>
  Effect.sync(() => eventBus.emit(AccessPolicyEvent.Granted, event));

const emitPolicyUpdated = (event: AccessPolicyUpdatedEvent): Effect.Effect<void, never> =>
  Effect.sync(() => eventBus.emit(AccessPolicyEvent.Updated, event));

const emitPolicyRevoked = (event: AccessPolicyRevokedEvent): Effect.Effect<void, never> =>
  Effect.sync(() => eventBus.emit(AccessPolicyEvent.Revoked, event));

// ---------------------------------------------------------------------------
// AccessPolicyWorkflows
// ---------------------------------------------------------------------------

@injectable()
export class AccessPolicyWorkflows {
  constructor(
    @inject(TOKENS.AccessPolicyRepository)
    private readonly policyRepo: IAccessPolicyRepository,
    @inject(TOKENS.DocumentRepository)
    private readonly documentRepo: IDocumentRepository,
    @inject(TOKENS.UserRepository)
    private readonly userRepo: IUserRepository,
  ) {}

  // -------------------------------------------------------------------------
  // grantAccess
  //
  // Creates a new access policy for a document.  Caller must be the document
  // owner or an admin.  Exactly one of `subjectId` (user-specific) or
  // `subjectRole` (role-based) must be provided — enforced by the domain entity.
  // -------------------------------------------------------------------------

  grantAccess(raw: GrantAccessCommandEncoded): Effect.Effect<AccessPolicyDTO, WorkflowError> {
    return pipe(
      decodeCommand(GrantAccessCommandSchema, raw, AccessPolicyWorkflowError.invalidInput),
      Effect.flatMap((cmd) =>
        pipe(
          requireDocForPolicy(this.documentRepo, cmd.documentId),
          Effect.flatMap((document) => assertPolicyManager(document, cmd.actor)),
          Effect.flatMap(() =>
            pipe(
              AccessPolicy.create({
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
                documentId: cmd.documentId as string,
                subjectId: cmd.subjectId !== undefined ? (cmd.subjectId as string) : null,
                subjectRole: cmd.subjectRole ?? null,
                action: cmd.action,
                effect: cmd.effect,
              }),
              Effect.mapError(() =>
                AccessPolicyWorkflowError.invalidInput(
                  "Exactly one of subjectId or subjectRole must be provided",
                ),
              ),
            ),
          ),
          Effect.flatMap((policy) =>
            pipe(
              this.policyRepo.save(policy),
              Effect.mapError(unavailable("policyRepo.save")),
              Effect.flatMap(() =>
                emitPolicyGranted({
                  actorId: cmd.actor.userId as string,
                  resourceId: policy.id as string,
                  documentId: cmd.documentId as string,
                  action: cmd.action,
                  effect: cmd.effect,
                }),
              ),
              Effect.as(toAccessPolicyDTO(policy)),
            ),
          ),
        ),
      ),
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
      Effect.flatMap((cmd) =>
        pipe(
          requirePolicy(this.policyRepo, cmd.policyId),
          Effect.flatMap((existing) =>
            pipe(
              requireDocForPolicy(this.documentRepo, existing.documentId),
              Effect.flatMap((document) => assertPolicyManager(document, cmd.actor)),
              Effect.flatMap(() =>
                pipe(
                  AccessPolicy.create({
                    id: crypto.randomUUID(),
                    createdAt: new Date().toISOString(),
                    documentId: existing.documentId as string,
                    subjectId: Option.getOrNull(existing.subjectId) as string | null,
                    subjectRole: Option.getOrNull(existing.subjectRole),
                    action: existing.action,
                    effect: cmd.effect,
                  }),
                  Effect.mapError(() =>
                    AccessPolicyWorkflowError.invalidInput("Policy reconstruction failed"),
                  ),
                ),
              ),
              Effect.flatMap((replacement) =>
                pipe(
                  this.policyRepo.delete(cmd.policyId),
                  Effect.mapError(unavailable("policyRepo.delete")),
                  Effect.flatMap(() =>
                    pipe(
                      this.policyRepo.save(replacement),
                      Effect.mapError(unavailable("policyRepo.save")),
                    ),
                  ),
                  Effect.flatMap(() =>
                    emitPolicyUpdated({
                      actorId: cmd.actor.userId as string,
                      resourceId: replacement.id as string,
                      previousPolicyId: cmd.policyId as string,
                      documentId: existing.documentId as string,
                      effect: cmd.effect,
                    }),
                  ),
                  Effect.as(toAccessPolicyDTO(replacement)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // revokeAccess
  //
  // Permanently removes an access policy.  Caller must be owner or admin.
  // -------------------------------------------------------------------------

  revokeAccess(raw: RevokeAccessCommandEncoded): Effect.Effect<void, WorkflowError> {
    return pipe(
      decodeCommand(RevokeAccessCommandSchema, raw, AccessPolicyWorkflowError.invalidInput),
      Effect.flatMap((cmd) =>
        pipe(
          requirePolicy(this.policyRepo, cmd.policyId),
          Effect.flatMap((existing) =>
            pipe(
              requireDocForPolicy(this.documentRepo, existing.documentId),
              Effect.flatMap((document) => assertPolicyManager(document, cmd.actor)),
              Effect.flatMap(() =>
                pipe(
                  this.policyRepo.delete(cmd.policyId),
                  Effect.mapError(unavailable("policyRepo.delete")),
                ),
              ),
              Effect.flatMap(() =>
                emitPolicyRevoked({
                  actorId: cmd.actor.userId as string,
                  resourceId: cmd.policyId as string,
                  documentId: existing.documentId as string,
                  action: existing.action,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // checkAccess
  //
  // Evaluates whether the requesting actor is permitted to perform `action` on
  // the specified document using full RBAC evaluation via DocumentAccessService.
  // Admins are always granted access (short-circuited inside the service).
  // -------------------------------------------------------------------------

  checkAccess(raw: CheckAccessQueryEncoded): Effect.Effect<boolean, WorkflowError> {
    return pipe(
      decodeCommand(CheckAccessQuerySchema, raw, AccessPolicyWorkflowError.invalidInput),
      Effect.flatMap((cmd) =>
        pipe(
          Effect.all(
            {
              docOpt: pipe(
                this.documentRepo.findById(cmd.documentId),
                Effect.mapError(unavailable("documentRepo.findById")),
              ),
              userOpt: pipe(
                this.userRepo.findById(cmd.actor.userId),
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
              return Effect.fail(
                AccessPolicyWorkflowError.notFound(`User '${cmd.actor.userId}'`),
              );
            }
            const document = docOpt.value;
            const user = userOpt.value;

            return pipe(
              Effect.all(
                {
                  subjectPolicies: pipe(
                    this.policyRepo.findByDocumentAndSubject(cmd.documentId, cmd.actor.userId),
                    Effect.mapError(unavailable("policyRepo.findByDocumentAndSubject")),
                  ),
                  rolePolicies: pipe(
                    this.policyRepo.findByDocumentAndRole(cmd.documentId, cmd.actor.role),
                    Effect.mapError(unavailable("policyRepo.findByDocumentAndRole")),
                  ),
                },
                { concurrency: 2 },
              ),
              Effect.map(({ subjectPolicies, rolePolicies }) =>
                DocumentAccessService.evaluate(
                  user,
                  [...subjectPolicies, ...rolePolicies],
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
      Effect.flatMap((cmd) =>
        pipe(
          requireDocForPolicy(this.documentRepo, cmd.documentId),
          Effect.flatMap((document) => assertPolicyManager(document, cmd.actor)),
          Effect.flatMap(() =>
            pipe(
              this.policyRepo.findByDocument(cmd.documentId),
              Effect.mapError(unavailable("policyRepo.findByDocument")),
            ),
          ),
          Effect.map((policies) => policies.map(toAccessPolicyDTO)),
        ),
      ),
    );
  }
}
