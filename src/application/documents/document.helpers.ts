import { Effect, Option, pipe } from "effect";
import {
  BucketKey,
  Checksum,
  type DocumentId,
  type VersionId,
  type UserId,
} from "@domain/utils/refined.types.ts";
import { isOwner } from "@domain/document/document.guards.ts";
import { Role } from "@domain/utils/enums.ts";
import type { Document } from "@domain/document/document.entity.ts";
import type { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { eventBus } from "@infra/event-bus.ts";
import {
  DocumentEvent,
  type DocumentUploadedEvent,
  type DocumentVersionCreatedEvent,
  type DocumentDeletedEvent,
} from "@domain/events/document.events.ts";
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
  documentId: string,
  versionId: string,
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
  actor: { readonly userId: UserId; readonly role: Role },
  action: string,
): Effect.Effect<Document, WorkflowError> {
  return actor.role !== Role.Admin && !isOwner(document, actor.userId)
    ? Effect.fail(
        DocumentWorkflowError.accessDenied(
          `User '${actor.userId}' cannot ${action} document '${document.id}'`,
        ),
      )
    : Effect.succeed(document);
}

// ---------------------------------------------------------------------------
// assertAdminOnly
// Gate that passes when the actor has the Admin role; fails with accessDenied
// otherwise. Use for operations that are admin-exclusive regardless of
// document ownership (e.g. hard-delete, role management).
//
// `action` is used in the error message, e.g. PermissionAction.Delete.
// ---------------------------------------------------------------------------

export function assertAdminOnly(
  actor: { readonly userId: UserId; readonly role: Role },
  action: string,
): Effect.Effect<void, WorkflowError> {
  return actor.role !== Role.Admin
    ? Effect.fail(
        DocumentWorkflowError.accessDenied(
          `User '${actor.userId}' does not have '${action}' permission`,
        ),
      )
    : Effect.void;
}

// ---------------------------------------------------------------------------
// requireDocument / requireActiveDocument
// Fetch a document by ID and convert a missing row into a notFound error.
// Use requireActiveDocument when soft-deleted documents should be invisible;
// use requireDocument when you need to operate on any row (e.g. hard-delete).
// ---------------------------------------------------------------------------

export function requireDocument(
  repo: IDocumentRepository,
  documentId: DocumentId,
): Effect.Effect<Document, WorkflowError> {
  return pipe(
    repo.findById(documentId),
    Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.findById", e)),
    Effect.flatMap((opt) =>
      Option.isNone(opt)
        ? Effect.fail(DocumentWorkflowError.notFound(`Document '${documentId}'`))
        : Effect.succeed(opt.value),
    ),
  );
}

export function requireActiveDocument(
  repo: IDocumentRepository,
  documentId: DocumentId,
): Effect.Effect<Document, WorkflowError> {
  return pipe(
    repo.findActiveById(documentId),
    Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.findActiveById", e)),
    Effect.flatMap((opt) =>
      Option.isNone(opt)
        ? Effect.fail(DocumentWorkflowError.notFound(`Document '${documentId}'`))
        : Effect.succeed(opt.value),
    ),
  );
}

// ---------------------------------------------------------------------------
// requireVersion
// Fetch a document version by ID and convert a missing row into notFound.
// ---------------------------------------------------------------------------

export function requireVersion(
  repo: IDocumentRepository,
  versionId: VersionId,
): Effect.Effect<DocumentVersion, WorkflowError> {
  return pipe(
    repo.findVersionById(versionId),
    Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.findVersionById", e)),
    Effect.flatMap((opt) =>
      Option.isNone(opt)
        ? Effect.fail(DocumentWorkflowError.notFound(`Version '${versionId}'`))
        : Effect.succeed(opt.value),
    ),
  );
}

// ---------------------------------------------------------------------------
// requireVersionOfDocument
// Asserts that a version belongs to the given document; fails with notFound
// if the foreign-key relationship does not match.
// ---------------------------------------------------------------------------

export function requireVersionOfDocument(
  version: DocumentVersion,
  document: Document,
): Effect.Effect<DocumentVersion, WorkflowError> {
  return version.documentId !== document.id
    ? Effect.fail(
        DocumentWorkflowError.notFound(
          `Version '${version.id}' does not belong to document '${document.id}'`,
        ),
      )
    : Effect.succeed(version);
}

// ---------------------------------------------------------------------------
// requireCurrentVersion
// Resolves a document's currentVersionId Option into a fetched DocumentVersion.
// Fails with notFound if the document has no current version yet, or if the
// version row is missing.
// ---------------------------------------------------------------------------

export function requireCurrentVersion(
  repo: IDocumentRepository,
  document: Document,
): Effect.Effect<DocumentVersion, WorkflowError> {
  return Option.isNone(document.currentVersionId)
    ? Effect.fail(
        DocumentWorkflowError.notFound(
          `Document '${document.id}' has no uploaded version yet`,
        ),
      )
    : requireVersion(repo, document.currentVersionId.value);
}

// ---------------------------------------------------------------------------
// parseMetadata
// Converts an optional raw JSON string into Record<string, string>.
// Wraps parseOptionalJson with a workflow-level error so callers don't need
// to re-map the error themselves.
// ---------------------------------------------------------------------------

export function parseMetadata(
  raw: string | null | undefined,
): Effect.Effect<Record<string, string>, WorkflowError> {
  return pipe(
    parseOptionalJson(Option.fromNullable(raw)),
    Effect.mapError(() =>
      DocumentWorkflowError.invalidInput(
        "Metadata must be a valid JSON object of string values",
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// hashBuffer
// SHA-256 hashes an ArrayBuffer and returns a branded Checksum string.
// ---------------------------------------------------------------------------

export function hashBuffer(buf: ArrayBuffer): Effect.Effect<Checksum, never> {
  return pipe(
    Effect.promise(() => crypto.subtle.digest("SHA-256", buf)),
    Effect.map((hash) => Checksum.create(Buffer.from(hash).toString("hex")).unwrap()),
  );
}

// ---------------------------------------------------------------------------
// commitVersion
// Persists a new version, points the document's currentVersionId at it, and
// saves the updated document.  Returns both for use by the caller.
// ---------------------------------------------------------------------------

export function commitVersion(
  repo: IDocumentRepository,
  doc: Document,
  version: DocumentVersion,
  now: Date,
): Effect.Effect<{ readonly version: DocumentVersion; readonly updated: Document }, WorkflowError> {
  return pipe(
    repo.saveVersion(version),
    Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.saveVersion", e)),
    Effect.flatMap(() =>
      pipe(
        doc.setCurrentVersion(version.id, now),
        Effect.mapError((e) => DocumentWorkflowError.conflict(e.message)),
      ),
    ),
    Effect.flatMap((updated) =>
      pipe(
        repo.update(updated),
        Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.update", e)),
        Effect.as({ version, updated }),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// requireAccessibleDocument
// Combines requireActiveDocument + assertDocumentAccess into a single step.
// Use in any read/write workflow that needs both existence and ownership checks.
// ---------------------------------------------------------------------------

export function requireAccessibleDocument(
  repo: IDocumentRepository,
  documentId: DocumentId,
  actor: { readonly userId: UserId; readonly role: Role },
  action: string,
): Effect.Effect<Document, WorkflowError> {
  return pipe(
    requireActiveDocument(repo, documentId),
    Effect.flatMap((document) => assertDocumentAccess(document, actor, action)),
  );
}

// ---------------------------------------------------------------------------
// Event emitters
// Thin Effect.sync wrappers so workflow code never imports eventBus directly.
// ---------------------------------------------------------------------------

export const emitDocumentUploaded = (event: DocumentUploadedEvent): Effect.Effect<void, never> =>
  Effect.sync(() => eventBus.emit(DocumentEvent.Uploaded, event));

export const emitVersionCreated = (
  event: DocumentVersionCreatedEvent,
): Effect.Effect<void, never> =>
  Effect.sync(() => eventBus.emit(DocumentEvent.VersionCreated, event));

export const emitDocumentDeleted = (event: DocumentDeletedEvent): Effect.Effect<void, never> =>
  Effect.sync(() => eventBus.emit(DocumentEvent.Deleted, event));
