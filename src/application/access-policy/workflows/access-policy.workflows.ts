import "reflect-metadata";
import { Effect as E, pipe } from "effect";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@infra/di/tokens.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import { DocumentAccessGuard } from "@application/security/document-access.guard.ts";
import {
  AccessPolicyWorkflowError,
  AccessPolicyWorkflowErrorTag,
  type AccessPolicyWorkflowError as WorkflowError,
} from "../access-policy-workflow.errors.ts";
import {
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
} from "../dtos/access-policy.dto.ts";
import {
  validateShareAccess,
  validateExistingPolicyAccess,
  buildGrantPolicy,
  requireExistingPolicy,
  buildPolicyReplacement,
  savePolicy,
  replacePolicy,
  deleteExistingPolicy,
} from "./steps/access-policy.context.steps.ts";
import {
  emitGrantPolicyCtx,
  emitUpdatePolicyCtx,
  emitRevokePolicyCtx,
} from "../events/access-policy.event.publishers.ts";
import {
  decode,
  fetchDocumentPolicies,
  toAccessPolicyDTO,
} from "./steps/access-policy.workflow.helpers.ts";

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
      E.flatMap(validateShareAccess(this.accessGuard)),
      E.flatMap(buildGrantPolicy),
      E.tap(savePolicy(this.policyRepo)),
      E.tap(emitGrantPolicyCtx),
      E.map(({ policy }) => toAccessPolicyDTO(policy)),
    );
  }

  // AccessPolicy is immutable; updating replaces it with a new ID (delete + save).
  updateAccess(raw: UpdateAccessCommandEncoded): E.Effect<AccessPolicyDTO, WorkflowError> {
    return pipe(
      decode(UpdateAccessCommandSchema, raw),
      E.flatMap(requireExistingPolicy(this.policyRepo)),
      E.flatMap(validateExistingPolicyAccess(this.accessGuard)),
      E.flatMap(buildPolicyReplacement),
      E.tap(replacePolicy(this.policyRepo)),
      E.tap(emitUpdatePolicyCtx),
      E.map(({ replacement }) => toAccessPolicyDTO(replacement)),
    );
  }

  revokeAccess(raw: RevokeAccessCommandEncoded): E.Effect<void, WorkflowError> {
    return pipe(
      decode(RevokeAccessCommandSchema, raw),
      E.flatMap(requireExistingPolicy(this.policyRepo)),
      E.flatMap(validateExistingPolicyAccess(this.accessGuard)),
      E.tap(deleteExistingPolicy(this.policyRepo)),
      E.tap(emitRevokePolicyCtx),
      E.as(undefined),
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
      E.flatMap(validateShareAccess(this.accessGuard)),
      E.flatMap(fetchDocumentPolicies(this.policyRepo)),
    );
  }
}
