import "reflect-metadata";
import { Effect as E, Option as O, pipe } from "effect";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@infra/di/tokens.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
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
  requireDocForPolicy,
  requirePolicy,
  assertPolicyManager,
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
    @inject(TOKENS.UserRepository)
    private readonly userRepo: IUserRepository,
  ) {}

  grantAccess(raw: GrantAccessCommandEncoded): E.Effect<AccessPolicyDTO, WorkflowError> {
    return pipe(
      decodeCommand(GrantAccessCommandSchema, raw, AccessPolicyWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          requireDocForPolicy(this.documentRepo, cmd.documentId),
          E.flatMap((document) => assertPolicyManager(document, cmd.actor)),
          E.flatMap(() =>
            buildPolicy(
              {
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
                documentId: cmd.documentId as string,
                subjectId: cmd.subjectId !== undefined ? (cmd.subjectId as string) : null,
                subjectRole: cmd.subjectRole ?? null,
                action: cmd.action,
                effect: cmd.effect,
              },
              "Exactly one of subjectId or subjectRole must be provided",
            ),
          ),
          E.flatMap((policy) =>
            pipe(
              this.policyRepo.save(policy),
              E.mapError(unavailable("policyRepo.save")),
              E.flatMap(() =>
                emitPolicyGranted({
                  actorId: cmd.actor.userId as string,
                  resourceId: policy.id as string,
                  documentId: cmd.documentId as string,
                  action: cmd.action,
                  effect: cmd.effect,
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
              requireDocForPolicy(this.documentRepo, existing.documentId),
              E.flatMap((document) => assertPolicyManager(document, cmd.actor)),
              E.flatMap(() =>
                buildPolicy(
                  {
                    id: crypto.randomUUID(),
                    createdAt: new Date().toISOString(),
                    documentId: existing.documentId as string,
                    subjectId: O.getOrNull(existing.subjectId) as string | null,
                    subjectRole: O.getOrNull(existing.subjectRole),
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
                      actorId: cmd.actor.userId as string,
                      resourceId: replacement.id as string,
                      previousPolicyId: cmd.policyId as string,
                      documentId: existing.documentId as string,
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
              requireDocForPolicy(this.documentRepo, existing.documentId),
              E.flatMap((document) => assertPolicyManager(document, cmd.actor)),
              E.flatMap(() =>
                pipe(
                  this.policyRepo.delete(cmd.policyId),
                  E.mapError(unavailable("policyRepo.delete")),
                ),
              ),
              E.flatMap(() =>
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

  checkAccess(raw: CheckAccessQueryEncoded): E.Effect<boolean, WorkflowError> {
    return pipe(
      decodeCommand(CheckAccessQuerySchema, raw, AccessPolicyWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          E.all(
            {
              docOpt: pipe(
                this.documentRepo.findById(cmd.documentId),
                E.mapError(unavailable("documentRepo.findById")),
              ),
              userOpt: pipe(
                this.userRepo.findById(cmd.actor.userId),
                E.mapError(unavailable("userRepo.findById")),
              ),
            },
            { concurrency: 2 },
          ),
          E.flatMap(({ docOpt, userOpt }) => {
            if (O.isNone(docOpt)) {
              return E.fail(AccessPolicyWorkflowError.notFound(`Document '${cmd.documentId}'`));
            }
            if (O.isNone(userOpt)) {
              return E.fail(AccessPolicyWorkflowError.notFound(`User '${cmd.actor.userId}'`));
            }
            const document = docOpt.value;
            const user = userOpt.value;

            return pipe(
              E.all(
                {
                  subjectPolicies: pipe(
                    this.policyRepo.findByDocumentAndSubject(cmd.documentId, cmd.actor.userId),
                    E.mapError(unavailable("policyRepo.findByDocumentAndSubject")),
                  ),
                  rolePolicies: pipe(
                    this.policyRepo.findByDocumentAndRole(cmd.documentId, cmd.actor.role),
                    E.mapError(unavailable("policyRepo.findByDocumentAndRole")),
                  ),
                },
                { concurrency: 2 },
              ),
              E.map(({ subjectPolicies, rolePolicies }) =>
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

  listDocumentPolicies(
    raw: ListDocumentPoliciesQueryEncoded,
  ): E.Effect<readonly AccessPolicyDTO[], WorkflowError> {
    return pipe(
      decodeCommand(ListDocumentPoliciesQuerySchema, raw, AccessPolicyWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          requireDocForPolicy(this.documentRepo, cmd.documentId),
          E.flatMap((document) => assertPolicyManager(document, cmd.actor)),
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
