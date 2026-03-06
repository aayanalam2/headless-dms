import { Effect, Option } from "effect";
import { BucketKey, type DocumentId, type VersionId, UserId } from "@domain/utils/refined.types.ts";
import { isOwner } from "@domain/document/document.guards.ts";
import { Role } from "@domain/utils/enums.ts";
import type { Document } from "@domain/document/document.entity.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "./document-workflow.errors.ts";

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
  return BucketKey.create(`${documentId}/${versionId}/${encodeURIComponent(filename)}`).unwrap();
}

// ---------------------------------------------------------------------------
// parseTags
// Splits a comma-separated tag string into a clean, deduplicated array.
// ---------------------------------------------------------------------------

export function parseTags(raw: Option.Option<string>): string[] {
  if (Option.isNone(raw) || raw.value.trim().length === 0) return [];
  return raw.value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// parseOptionalJson
// Parses an optional JSON string into Record<string, string>.
// Returns an empty object when the input is absent or blank.
// ---------------------------------------------------------------------------

export function parseOptionalJson(
  raw: Option.Option<string>,
): Effect.Effect<Record<string, string>, Error> {
  if (Option.isNone(raw) || raw.value.trim().length === 0) return Effect.succeed({});
  const str = raw.value;
  return Effect.try({
    try: () => {
      const parsed: unknown = JSON.parse(str);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("metadata must be a JSON object of string values");
      }
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== "string") {
          throw new Error(`metadata value for "${k}" must be a string`);
        }
      }
      return parsed as Record<string, string>;
    },
    catch: (e) => (e instanceof Error ? e : new Error("metadata must be valid JSON")),
  });
}

// ---------------------------------------------------------------------------
// assertDocumentAccess
// Succeeds with the document when the actor is an Admin or the document owner;
// otherwise fails with an accessDenied workflow error.
//
// `action` is a short verb phrase used in the error message, e.g. "read",
// "download", "list versions of".
// ---------------------------------------------------------------------------

export function assertDocumentAccess(
  document: Document,
  actor: { readonly userId: string; readonly role: Role },
  action: string,
): Effect.Effect<Document, WorkflowError> {
  const actorId = UserId.create(actor.userId).unwrap();
  return actor.role !== Role.Admin && !isOwner(document, actorId)
    ? Effect.fail(
        DocumentWorkflowError.accessDenied(
          `User '${actor.userId}' cannot ${action} document '${document.id}'`,
        ),
      )
    : Effect.succeed(document);
}
