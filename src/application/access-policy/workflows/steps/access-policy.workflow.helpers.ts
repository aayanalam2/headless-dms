import { Effect as E } from "effect";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import type { DocumentId } from "@domain/utils/refined.types.ts";
import { makeDecoder } from "@application/shared/decode.ts";
import {
  AccessPolicyWorkflowError,
  type AccessPolicyWorkflowError as WorkflowError,
} from "../../access-policy-workflow.errors.ts";
import { liftRepo } from "../../services/access-policy.repository.service.ts";
import { toAccessPolicyDTO, type AccessPolicyDTO } from "../../dtos/access-policy.dto.ts";

/** Decode a raw input against a schema, mapping parse errors to InvalidInput. */
export const decode = makeDecoder(AccessPolicyWorkflowError.invalidInput);

/** Fetches all policies for a document and returns them as DTOs. */
export function fetchDocumentPolicies(
  repo: IAccessPolicyRepository,
): (ctx: { documentId: DocumentId }) => E.Effect<readonly AccessPolicyDTO[], WorkflowError> {
  return (ctx) =>
    E.map(liftRepo(repo.findByDocument(ctx.documentId)), (policies) =>
      policies.map(toAccessPolicyDTO),
    );
}

/** Maps an AccessPolicy entity to its DTO. Re-exported for use in workflow map steps. */
export { toAccessPolicyDTO };
