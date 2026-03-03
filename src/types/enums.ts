// ---------------------------------------------------------------------------
// Domain enums — closed categorical sets used throughout the application.
//
// Using string enums gives both type safety and human-readable values in
// logs, the database, and over-the-wire JSON.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Role — RBAC roles assigned to every user account.
// ---------------------------------------------------------------------------

export enum Role {
  Admin = "admin",
  User = "user",
}

// ---------------------------------------------------------------------------
// AuditAction — every distinct operation that is written to the audit log.
// ---------------------------------------------------------------------------

export enum AuditAction {
  DocumentUpload = "document.upload",
  DocumentVersionCreate = "document.version.create",
  DocumentDelete = "document.delete",
}

// ---------------------------------------------------------------------------
// AuditResourceType — the kinds of entities that audit events reference.
// ---------------------------------------------------------------------------

export enum AuditResourceType {
  Document = "document",
}
