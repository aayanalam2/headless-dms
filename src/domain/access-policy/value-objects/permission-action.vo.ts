// ---------------------------------------------------------------------------
// PermissionAction — the set of operations a policy can grant or deny.
// ---------------------------------------------------------------------------

/**
 * All discrete operations that can be controlled by an AccessPolicy.
 *
 * - Read   : fetch document metadata and download file content.
 * - Write  : upload a new version, rename, update tags/metadata.
 * - Delete : soft-delete the document.
 * - Share  : create, update, or revoke access policies for the document.
 */
export enum PermissionAction {
  Read = "read",
  Write = "write",
  Delete = "delete",
  Share = "share",
}

// ---------------------------------------------------------------------------
// PolicyEffect — whether the policy grants or denies the action.
// ---------------------------------------------------------------------------

/**
 * Within a precedence tier (subject > role), `Deny` always overrides
 * `Allow` — a single explicit deny blocks access regardless of other
 * allow policies in the same tier.
 */
export enum PolicyEffect {
  Allow = "allow",
  Deny = "deny",
}
