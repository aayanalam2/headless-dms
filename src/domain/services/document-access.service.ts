import { Option, pipe } from "effect";
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
//
// The tiered evaluation is modelled as an Option<boolean> pipeline:
//   • Some(true)  — the tier reached an ALLOW decision.
//   • Some(false) — the tier reached a DENY decision.
//   • None        — the tier was undecided; fall through to the next.
// ---------------------------------------------------------------------------

/**
 * Evaluates a single tier of the access control decision.
 *
 * Returns `Some(false)` if any policy denies,
 * `Some(true)` if any policy allows and none denies,
 * or `None` if no matching policies exist (undecided — try next tier).
 */
const decideTier = (tierPolicies: readonly IAccessPolicy[]): Option.Option<boolean> => {
  if (tierPolicies.length === 0) return Option.none();
  if (tierPolicies.some((p) => p.effect === PolicyEffect.Deny)) return Option.some(false);
  if (tierPolicies.some((p) => p.effect === PolicyEffect.Allow)) return Option.some(true);
  return Option.none();
};

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
    // Tier 1 — Admin bypass: short-circuit before any policy evaluation.
    if (isAdmin(user)) return true;

    // Narrow to policies governing this specific action on this document.
    const relevant = policies.filter(
      (p) => p.documentId === document.id && p.action === action,
    );

    // Tier 2 — Subject policies: explicitly target this user by ID.
    const subjectPolicies = relevant.filter((p) =>
      Option.exists(p.subjectId, (id) => id === user.id),
    );

    // Tier 3 — Role policies: target the user's role.
    const rolePolicies = relevant.filter((p) =>
      Option.exists(p.subjectRole, (role) => role === user.role),
    );

    // Chain tiers via Option<boolean>.  The first tier that reaches a decision
    // (Some) short-circuits; None passes control to the next tier.
    // getOrElse provides the default-deny fallback.
    return pipe(
      decideTier(subjectPolicies),
      Option.orElse(() => decideTier(rolePolicies)),
      Option.getOrElse(() => false),
    );
  }

  /**
   * Evaluates all four standard actions in one call.
   * Useful for building permission summaries in read-model queries.
   */
  static evaluateAll(
    user: IUser,
    policies: readonly IAccessPolicy[],
    document: IDocument,
  ): Record<PermissionAction, boolean> {
    const check = (action: PermissionAction) =>
      DocumentAccessService.evaluate(user, policies, document, action);

    return {
      [PermissionAction.Read]: check(PermissionAction.Read),
      [PermissionAction.Write]: check(PermissionAction.Write),
      [PermissionAction.Delete]: check(PermissionAction.Delete),
      [PermissionAction.Share]: check(PermissionAction.Share),
    };
  }
}

