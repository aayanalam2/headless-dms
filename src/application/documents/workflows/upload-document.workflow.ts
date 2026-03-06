import { Effect, Option, pipe } from "effect";
import { Document } from "@domain/document/document.entity.ts";
import type { ContentType } from "@domain/document/value-objects/content-type.vo.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { DocumentId, VersionId, Checksum, UserId } from "@domain/utils/refined.types.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { buildBucketKey, parseTags, parseOptionalJson } from "../document.helpers.ts";
import { eventBus } from "@infra/event-bus.ts";
import { DocumentEvent } from "@domain/events/document.events.ts";
import {
  toDocumentDTO,
  toVersionDTO,
  type DocumentDTO,
  type VersionDTO,
} from "../dtos/document.dto.ts";
import { UploadDocumentMetaSchema, type UploadDocumentMetaEncoded } from "../dtos/commands.dto.ts";
import { decodeCommand, pipe as p } from "@application/shared/decode.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "../document-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadDocumentResult = {
  readonly document: DocumentDTO;
  readonly version: VersionDTO;
};

export type UploadDocumentDeps = {
  readonly documentRepo: IDocumentRepository;
  readonly storage: IStorage;
};

// ---------------------------------------------------------------------------
// Infra error mapper helpers (local)
// ---------------------------------------------------------------------------

const unavailable =
  (op: string) =>
  (e: unknown): WorkflowError =>
    DocumentWorkflowError.unavailable(op, e);

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export function uploadDocument(
  deps: UploadDocumentDeps,
  rawMeta: UploadDocumentMetaEncoded,
  file: File,
): Effect.Effect<UploadDocumentResult, WorkflowError> {
  return pipe(
    decodeCommand(UploadDocumentMetaSchema, rawMeta, DocumentWorkflowError.invalidInput),
    Effect.flatMap((meta) =>
      Effect.gen(function* () {
        const now = new Date();
        const actorId = UserId.create(meta.actor.userId).unwrap();

        const metadata = yield* p(
          parseOptionalJson(Option.fromNullable(meta.rawMetadata)),
          Effect.mapError(() =>
            DocumentWorkflowError.invalidInput(
              "Metadata must be a valid JSON object of string values",
            ),
          ),
        );
        const tags = parseTags(Option.fromNullable(meta.rawTags));
        const filename = meta.name?.trim() || file.name || "untitled";
        const contentType = file.type || "application/octet-stream";

        const docId = DocumentId.create(crypto.randomUUID()).unwrap();
        const verId = VersionId.create(crypto.randomUUID()).unwrap();
        const bucketKey = buildBucketKey(docId, verId, filename);

        const docResult = yield* p(
          Document.create({
            id: docId as string,
            ownerId: actorId as string,
            name: filename,
            contentType: contentType as ContentType,
            currentVersionId: null,
            tags,
            metadata,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            deletedAt: null,
          }),
          Effect.mapError((e) => DocumentWorkflowError.invalidContentType(e.contentType)),
        );

        const fileBuffer = yield* Effect.promise(() => file.arrayBuffer());
        const hashBuffer = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", fileBuffer));
        const checksum = Checksum.create(Buffer.from(hashBuffer).toString("hex")).unwrap();

        yield* p(
          deps.storage.uploadFile(bucketKey, Buffer.from(fileBuffer), docResult.contentType),
          Effect.mapError(unavailable("storage.uploadFile")),
        );

        yield* p(deps.documentRepo.save(docResult), Effect.mapError(unavailable("repo.save")));

        const version = yield* pipe(
          DocumentVersion.create({
            id: verId as string,
            createdAt: now.toISOString(),
            documentId: docId as string,
            versionNumber: 1,
            bucketKey: bucketKey as string,
            sizeBytes: fileBuffer.byteLength,
            checksum: checksum as string,
            uploadedBy: actorId as string,
          }),
          Effect.mapError((e) => DocumentWorkflowError.unavailable("DocumentVersion.create", e)),
        );

        yield* p(
          deps.documentRepo.saveVersion(version),
          Effect.mapError(unavailable("repo.saveVersion")),
        );

        const updated = yield* p(
          docResult.setCurrentVersion(verId, now),
          Effect.mapError((e) => DocumentWorkflowError.conflict(e.message)),
        );

        yield* p(deps.documentRepo.update(updated), Effect.mapError(unavailable("repo.update")));

        eventBus.emit(DocumentEvent.Uploaded, {
          actorId: meta.actor.userId,
          resourceId: docId as string,
          versionId: verId as string,
          filename,
          contentType: docResult.contentType,
        });

        return { document: toDocumentDTO(updated), version: toVersionDTO(version) };
      }),
    ),
  );
}
