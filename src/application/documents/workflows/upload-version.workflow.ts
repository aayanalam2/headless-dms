import { Effect, pipe } from "effect";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { buildBucketKey, requireActiveDocument, hashBuffer } from "../document.helpers.ts";
import { eventBus } from "@infra/event-bus.ts";
import { DocumentEvent } from "@domain/events/document.events.ts";
import { toVersionDTO, type VersionDTO } from "../dtos/document.dto.ts";
import { UploadVersionMetaSchema, type UploadVersionMetaEncoded } from "../dtos/commands.dto.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "../document-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadVersionResult = { readonly version: VersionDTO };

export type UploadVersionDeps = {
  readonly documentRepo: IDocumentRepository;
  readonly storage: IStorage;
};

const unavailable =
  (op: string) =>
  (e: unknown): WorkflowError =>
    DocumentWorkflowError.unavailable(op, e);

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export function uploadVersion(
  deps: UploadVersionDeps,
  rawMeta: UploadVersionMetaEncoded,
  file: File,
): Effect.Effect<UploadVersionResult, WorkflowError> {
  return pipe(
    decodeCommand(UploadVersionMetaSchema, rawMeta, DocumentWorkflowError.invalidInput),
    Effect.flatMap((meta) => {
      const now = new Date();
      const verId = crypto.randomUUID();

      return pipe(
        // load doc + version history in parallel
        Effect.all([
          requireActiveDocument(deps.documentRepo, meta.documentId),
          pipe(
            deps.documentRepo.findVersionsByDocument(meta.documentId),
            Effect.mapError(unavailable("repo.findVersionsByDocument")),
          ),
        ]),
        Effect.map(([document, versions]) => {
          const filename = meta.name?.trim() || file.name || document.name;
          const contentType = file.type || document.contentType;
          const versionNumber =
            versions.length === 0
              ? 1
              : versions.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
          const bucketKey = buildBucketKey(meta.documentId as string, verId, filename);
          return { document, filename, contentType, versionNumber, bucketKey };
        }),

        // upload
        Effect.flatMap(({ document, filename, contentType, versionNumber, bucketKey }) =>
          pipe(
            Effect.all([
              Effect.promise(() => file.arrayBuffer()),
            ]),
            Effect.flatMap(([buffer]) =>
              pipe(
                Effect.all([
                  hashBuffer(buffer),
                  pipe(
                    deps.storage.uploadFile(bucketKey, Buffer.from(buffer), contentType),
                    Effect.mapError(unavailable("storage.uploadFile")),
                  ),
                ]),
                Effect.map(([checksum]) => ({
                  document,
                  filename,
                  contentType,
                  versionNumber,
                  bucketKey,
                  buffer,
                  checksum,
                })),
              ),
            ),
          ),
        ),

        // save version
        Effect.flatMap(({ document, filename, versionNumber, bucketKey, buffer, checksum }) =>
          pipe(
            DocumentVersion.create({
              id: verId,
              documentId: meta.documentId as string,
              versionNumber,
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
                    document.setCurrentVersion(version.id, now),
                    Effect.mapError((e) => DocumentWorkflowError.conflict(e.message)),
                  ),
                ),
                Effect.flatMap((updated) =>
                  pipe(
                    deps.documentRepo.update(updated),
                    Effect.mapError(unavailable("repo.update")),
                    Effect.as({ version, versionNumber, filename }),
                  ),
                ),
              ),
            ),
          ),
        ),

        // emit event
        Effect.tap(({ version, versionNumber, filename }) =>
          Effect.sync(() =>
            eventBus.emit(DocumentEvent.VersionCreated, {
              actorId: meta.actor.userId,
              resourceId: meta.documentId as string,
              versionId: version.id as string,
              versionNumber,
              filename,
            }),
          ),
        ),

        Effect.map(({ version }) => ({ version: toVersionDTO(version) })),
      );
    }),
  );
}
