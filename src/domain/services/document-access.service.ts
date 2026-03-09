import { Option as O, pipe } from "effect";
import type { IDocument } from "@domain/document/document.entity.ts";
import type { IAccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { Role } from "@domain/utils/enums.ts";
import type { UserId } from "@domain/utils/refined.types.ts";

/** Actions that owners are implicitly granted without an explicit policy. */
const OWNER_BYPASS_ACTIONS = new Set<PermissionAction>([
  PermissionAction.Read,
  PermissionAction.Write,
  PermissionAction.Share,
]);

const decideTier = (tierPolicies: readonly IAccessPolicy[]): O.Option<boolean> => {
  if (tierPolicies.length === 0) return O.none();
  if (tierPolicies.some((p) => p.effect === PolicyEffect.Deny)) return O.some(false);
  if (tierPolicies.some((p) => p.effect === PolicyEffect.Allow)) return O.some(true);
  return O.none();
};

export class DocumentAccessService {
  /**
   * Evaluates whether `actor` may perform `action` on `document`.
   *
   * @param actor    - The acting user's identity (`id`) and `role`.
   * @param policies - All *subject* AccessPolicies for the document that
   *                   target `actor.id`.  Callers are responsible for loading
   *                   only the relevant subset from the repository.
   * @param document - The target document.
   * @param action   - The operation being evaluated.
   * @returns `true`  if the actor has the requested permission.
   * @returns `false` if access is denied by an explicit policy or default deny.
   */
  static evaluate(
    actor: { readonly id: UserId; readonly role: Role },
    policies: readonly IAccessPolicy[],
    document: IDocument,
    action: PermissionAction,
  ): boolean {
    if (actor.role === Role.Admin) return true;

    if (document.ownerId === actor.id && OWNER_BYPASS_ACTIONS.has(action)) return true;

    const relevant = policies.filter((p) => p.documentId === document.id && p.action === action);

    const subjectPolicies = relevant.filter((p) => p.subjectId === actor.id);
    return pipe(
      decideTier(subjectPolicies),
      O.getOrElse(() => false),
    );
  }

  /**
   * Evaluates all four standard actions in one call.
   * Useful for building permission summaries in read-model queries.
   */
  static evaluateAll(
    actor: { readonly id: UserId; readonly role: Role },
    policies: readonly IAccessPolicy[],
    document: IDocument,
  ): Record<PermissionAction, boolean> {
    const check = (action: PermissionAction) =>
      DocumentAccessService.evaluate(actor, policies, document, action);

    return {
      [PermissionAction.Read]: check(PermissionAction.Read),
      [PermissionAction.Write]: check(PermissionAction.Write),
      [PermissionAction.Delete]: check(PermissionAction.Delete),
      [PermissionAction.Share]: check(PermissionAction.Share),
    };
  }
}
