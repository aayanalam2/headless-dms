// ---------------------------------------------------------------------------
// Domain-owned enums.
//
// These enums belong to the domain layer and are the single source of truth.
// Application and infrastructure layers should import from here, not from
// their own copies.
// ---------------------------------------------------------------------------

/**
 * RBAC roles.  Every user account carries exactly one role.
 *
 * Precedence (highest → lowest):
 *   Admin — unrestricted access to every resource.
 *   User  — subject to AccessPolicy rules; default-deny otherwise.
 */
export enum Role {
  Admin = "admin",
  User = "user",
}

/** Every distinct operation recorded in the audit log. */
export enum AuditAction {
  DocumentUpload = "document.upload",
  DocumentVersionCreate = "document.version.create",
  DocumentDelete = "document.delete",
}

/** The kinds of entities that audit events reference. */
export enum AuditResourceType {
  Document = "document",
}
