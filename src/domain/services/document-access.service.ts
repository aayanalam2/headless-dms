import { Option } from "effect";
import type { IDocument } from "@domain/document/document.entity.ts";
import type { IUser } from "@domain/user/user.entity.ts";
import type { IAccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { isAdmin } from "@domain/user/user.guards.ts";

// ---------------------------------------------------------------------------
// DocumentAccessService
//
// Pure domain service that evaluates whether a User has a given permission
// on a Document, given the set of AccessPolicies that apply to it.
//
// No I/O.  No external dependencies.  Fully deterministic.
//
// Evaluation precedence:
//   1. Admin role            → always ALLOW.
//   2. Subject policies      → policies targeting this specific user.
//      Within tier: a single DENY overrides all ALLOWs.
//   3. Role policies         → policies targeting the user's role.
//      Within tier: a single DENY overrides all ALLOWs.
//   4. Default               → DENY.
// ---------------------------------------------------------------------------

export class DocumentAccessService {
  /**
   * Evaluates whether `user` may perform `action` on `document`.
   *
   * @param user     - The acting user.
   * @param policies - All AccessPolicies for the document.  Callers are
   *                   responsible for loading only the policies relevant to
   *                   `document.id` (filtering at the repository is fine).
   * @param document - The target document.
   * @param action   - The operation being evaluated.
   * @returns `true`  if the user has the requested permission.
   * @returns `false` if access is denied by an explicit policy or default deny.
   */
  static evaluate(
    user: IUser,
    policies: readonly IAccessPolicy[],
    document: IDocument,
    action: PermissionAction,
  ): boolean {
    // -----------------------------------------------------------------------
    // Tier 1 — Admin bypass
    // Admins have unrestricted access to every document regardless of policies.
    // -----------------------------------------------------------------------
    if (isAdmin(user)) return true;

    // Narrow the full policy list to only those relevant to this action
    // on this document.  Policies for other documents or other actions are
    // irrelevant and should not influence the result.
    const relevant = policies.filter((p) => p.documentId === document.id && p.action === action);

    // -----------------------------------------------------------------------
    // Tier 2 — Subject policies (user-specific)
    // An explicit policy targeting this exact user takes precedence over role
    // policies.  Within this tier, any single DENY overrides all ALLOWs.
    // -----------------------------------------------------------------------
    const subjectPolicies = relevant.filter(
      (p) => Option.isSome(p.subjectId) && p.subjectId.value === user.id,
    );

    if (subjectPolicies.length > 0) {
      if (subjectPolicies.some((p) => p.effect === PolicyEffect.Deny)) return false;
      if (subjectPolicies.some((p) => p.effect === PolicyEffect.Allow)) return true;
    }

    // -----------------------------------------------------------------------
    // Tier 3 — Role policies
    // Policies targeting the user's role.  Same deny-wins logic as tier 2.
    // -----------------------------------------------------------------------
    const rolePolicies = relevant.filter(
      (p) => Option.isSome(p.subjectRole) && p.subjectRole.value === user.role,
    );

    if (rolePolicies.length > 0) {
      if (rolePolicies.some((p) => p.effect === PolicyEffect.Deny)) return false;
      if (rolePolicies.some((p) => p.effect === PolicyEffect.Allow)) return true;
    }

    // -----------------------------------------------------------------------
    // Tier 4 — Default deny
    // No matching policy granted access.
    // -----------------------------------------------------------------------
    return false;
  }

  /**
   * Convenience overload that evaluates all four standard actions at once.
   * Useful for building permission summaries in read-model queries.
   */
  static evaluateAll(
    user: IUser,
    policies: readonly IAccessPolicy[],
    document: IDocument,
  ): Record<PermissionAction, boolean> {
    return {
      [PermissionAction.Read]: DocumentAccessService.evaluate(
        user,
        policies,
        document,
        PermissionAction.Read,
      ),
      [PermissionAction.Write]: DocumentAccessService.evaluate(
        user,
        policies,
        document,
        PermissionAction.Write,
      ),
      [PermissionAction.Delete]: DocumentAccessService.evaluate(
        user,
        policies,
        document,
        PermissionAction.Delete,
      ),
      [PermissionAction.Share]: DocumentAccessService.evaluate(
        user,
        policies,
        document,
        PermissionAction.Share,
      ),
    };
  }
}
