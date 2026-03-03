import type { DocumentRow, VersionRow } from "../models/db/schema.ts";
import type { BucketKey, DocumentId, VersionId } from "../types/branded.ts";
import { AppError, type AppResult, Result } from "../types/errors.ts";
import type { JwtClaims } from "./auth.service.ts";

// ---------------------------------------------------------------------------
// Document service — pure RBAC policies and domain helpers.
//
// None of these functions perform I/O. They take data, apply rules, and return
// a value or an error. This is the functional core of the document domain.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RBAC policies
//
// Rules:
//   admin  → can do anything to any document
//   user   → can read/write only their own documents; cannot hard-delete
// ---------------------------------------------------------------------------

export function canRead(
  actor: JwtClaims,
  doc: DocumentRow,
): AppResult<true> {
  if (actor.role === "admin" || doc.ownerId === actor.userId) {
    return Result.Ok(true as const);
  }
  return Result.Err(AppError.accessDenied("You do not have access to this document"));
}

export function canWrite(
  actor: JwtClaims,
  doc: DocumentRow,
): AppResult<true> {
  if (actor.role === "admin" || doc.ownerId === actor.userId) {
    return Result.Ok(true as const);
  }
  return Result.Err(AppError.accessDenied("You cannot modify this document"));
}

export function canDelete(actor: JwtClaims): AppResult<true> {
  if (actor.role === "admin") {
    return Result.Ok(true as const);
  }
  return Result.Err(AppError.accessDenied("Only admins can delete documents"));
}

// ---------------------------------------------------------------------------
// buildBucketKey
// Produces a deterministic, immutable S3 object key.
// Format: {documentId}/{versionId}/{encodedFilename}
// The versionId makes the key globally unique so objects are never overwritten.
// ---------------------------------------------------------------------------

export function buildBucketKey(
  documentId: DocumentId,
  versionId: VersionId,
  filename: string,
): BucketKey {
  // Percent-encode the filename to keep the key S3-safe
  const safe = encodeURIComponent(filename);
  return `${documentId}/${versionId}/${safe}` as BucketKey;
}

// ---------------------------------------------------------------------------
// nextVersionNumber
// Pure function: given the existing versions for a document, return the next
// version number. The first version is 1.
// ---------------------------------------------------------------------------

export function nextVersionNumber(versions: VersionRow[]): number {
  if (versions.length === 0) return 1;
  const max = versions.reduce(
    (m, v) => Math.max(m, v.versionNumber),
    0,
  );
  return max + 1;
}

// ---------------------------------------------------------------------------
// validateContentType
// Ensures the MIME type is a non-empty string.
// A simple guard — actual MIME validation can be extended in future iterations.
// ---------------------------------------------------------------------------

export function validateContentType(contentType: string): AppResult<string> {
  if (!contentType || contentType.trim().length === 0) {
    return Result.Err(AppError.validation("Content-Type must not be empty"));
  }
  return Result.Ok(contentType.trim());
}
