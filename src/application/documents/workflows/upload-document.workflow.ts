import { Effect, Option, pipe } from "effect";
import { Document } from "@domain/document/document.entity.ts";
import type { ContentType } from "@domain/document/value-objects/content-type.vo.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { buildBucketKey, parseTags, parseMetadata, hashBuffer } from "../document.helpers.ts";
import { eventBus } from "@infra/event-bus.ts";
import { DocumentEvent } from "@domain/events/document.events.ts";
import {
  toDocumentDTO,
  toVersionDTO,
  type DocumentDTO,
  type VersionDTO,
} from "../dtos/document.dto.ts";
import { UploadDocumentMetaSchema, type UploadDocumentMetaEncoded } from "../dtos/commands.dto.ts";
import { decodeCommand } from "@application/shared/decode.ts";
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
    Effect.flatMap((meta) => {
      const now = new Date();
      const docId = crypto.randomUUID();
      const verId = crypto.randomUUID();
      const filename = meta.name?.trim() || file.name || "untitled";
      const contentType = (file.type || "application/octet-stream") as ContentType;
      const bucketKey = buildBucketKey(docId, verId, filename);

      return pipe(
        // parse params
        Effect.all([
          parseMetadata(meta.rawMetadata),
          Effect.promise(() => file.arrayBuffer()),
        ]),
        Effect.map(([metadata, buffer]) => ({
          metadata,
          buffer,
          tags: parseTags(Option.fromNullable(meta.rawTags)),
        })),

        // create doc
        Effect.flatMap(({ metadata, buffer, tags }) =>
          pipe(
            Document.create({
              id: docId,
              ownerId: meta.actor.userId as string,
              name: filename,
              contentType,
              currentVersionId: null,
              tags,
              metadata,
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
              deletedAt: null,
            }),
            Effect.mapError((e) => DocumentWorkflowError.invalidContentType(e.contentType)),
            Effect.map((doc) => ({ doc, buffer })),
          ),
        ),

        // upload
        Effect.flatMap(({ doc, buffer }) =>
          pipe(
            Effect.all([
              hashBuffer(buffer),
              pipe(
                deps.storage.uploadFile(bucketKey, Buffer.from(buffer), doc.contentType),
                Effect.mapError(unavailable("storage.uploadFile")),
              ),
            ]),
            Effect.map(([checksum]) => ({ doc, buffer, checksum })),
          ),
        ),

        // save
        Effect.flatMap(({ doc, buffer, checksum }) =>
          pipe(
            deps.documentRepo.save(doc),
            Effect.mapError(unavailable("repo.save")),
            Effect.as({ doc, buffer, checksum }),
          ),
        ),

        // save version
        Effect.flatMap(({ doc, buffer, checksum }) =>
          pipe(
            DocumentVersion.create({
              id: verId,
              documentId: docId,
              versionNumber: 1,
              bucketKey: bucketKey as string,
              sizeBytes: buffer.byteLength,
              checksum: checksum as string,
              uploadedBy: meta.actor.userId as string,
              createdAt: now.toISOString(),
            }),
            Effect.mapError((e) => DocumentWorkflowError.unavailable("DocumentVersion.create", e)),
            Effect.flatMap((version) =>
              pipe(
                deps.documentRepo.saveVersion(version),
                Effect.mapError(unavailable("repo.saveVersion")),
                Effect.flatMap(() =>
                  pipe(
                    doc.setCurrentVersion(version.id, now),
                    Effect.mapError((e) => DocumentWorkflowError.conflict(e.message)),
                  ),
                ),
                Effect.flatMap((updated) =>
                  pipe(
                    deps.documentRepo.update(updated),
                    Effect.mapError(unavailable("repo.update")),
                    Effect.as({ updated, version }),
                  ),
                ),
              ),
            ),
          ),
        ),

        // emit event
        Effect.tap(({ updated, version }) =>
          Effect.sync(() =>
            eventBus.emit(DocumentEvent.Uploaded, {
              actorId: meta.actor.userId,
              resourceId: updated.id as string,
              versionId: version.id as string,
              filename,
              contentType: updated.contentType,
            }),
          ),
        ),

        Effect.map(({ updated, version }) => ({
          document: toDocumentDTO(updated),
          version: toVersionDTO(version),
        })),
      );
    }),
  );
}
