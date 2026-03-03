import { Effect } from "effect";
import type { VersionRow } from "../models/db/schema.ts";
import type { BucketKey, DocumentId, VersionId } from "../types/branded.ts";
import { AppError } from "../types/errors.ts";

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
  const max = versions.reduce((m, v) => Math.max(m, v.versionNumber), 0);
  return max + 1;
}

// ---------------------------------------------------------------------------
// validateContentType
// Ensures the MIME type is a non-empty string.
// A simple guard — actual MIME validation can be extended in future iterations.
// ---------------------------------------------------------------------------

export function validateContentType(contentType: string): Effect.Effect<string, AppError> {
  if (!contentType || contentType.trim().length === 0) {
    return Effect.fail(AppError.validation("Content-Type must not be empty"));
  }
  return Effect.succeed(contentType.trim());
}
