import { Effect, Option, pipe } from "effect";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { DocumentId, VersionId, Checksum, UserId } from "@domain/utils/refined.types.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { buildBucketKey } from "../document.helpers.ts";
import { eventBus } from "@infra/event-bus.ts";
import { DocumentEvent } from "@domain/events/document.events.ts";
import { toVersionDTO, type VersionDTO } from "../dtos/document.dto.ts";
import { UploadVersionMetaSchema, type UploadVersionMetaEncoded } from "../dtos/commands.dto.ts";
import { decodeCommand, pipe as p } from "@application/shared/decode.ts";
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
    Effect.flatMap((meta) =>
      Effect.gen(function* () {
        const now = new Date();
        const actorId = UserId.create(meta.actor.userId).unwrap();
        const docId = DocumentId.create(meta.documentId).unwrap();

        const docOption = yield* p(
          deps.documentRepo.findActiveById(docId),
          Effect.mapError(unavailable("repo.findActiveById")),
        );
        if (Option.isNone(docOption)) {
          return yield* Effect.fail(
            DocumentWorkflowError.notFound(`Document '${meta.documentId}'`),
          );
        }
        const document = docOption.value;

        const filename = meta.name?.trim() || file.name || document.name;
        const contentType = file.type || document.contentType;

        const versions = yield* p(
          deps.documentRepo.findVersionsByDocument(docId),
          Effect.mapError(unavailable("repo.findVersionsByDocument")),
        );
        const versionNumber =
          versions.length === 0
            ? 1
            : versions.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;

        const verId = VersionId.create(crypto.randomUUID()).unwrap();
        const bucketKey = buildBucketKey(docId, verId, filename);

        const fileBuffer = yield* Effect.promise(() => file.arrayBuffer());
        const hashBuffer = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", fileBuffer));
        const checksum = Checksum.create(Buffer.from(hashBuffer).toString("hex")).unwrap();

        yield* p(
          deps.storage.uploadFile(bucketKey, Buffer.from(fileBuffer), contentType),
          Effect.mapError(unavailable("storage.uploadFile")),
        );

        const version = yield* pipe(
          DocumentVersion.create({
            id: verId as string,
            createdAt: now.toISOString(),
            documentId: docId as string,
            versionNumber,
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
          document.setCurrentVersion(verId, now),
          Effect.mapError((e) => DocumentWorkflowError.conflict(e.message)),
        );

        yield* p(deps.documentRepo.update(updated), Effect.mapError(unavailable("repo.update")));

        eventBus.emit(DocumentEvent.VersionCreated, {
          actorId: meta.actor.userId,
          resourceId: meta.documentId,
          versionId: verId as string,
          versionNumber,
          filename,
        });

        return { version: toVersionDTO(version) };
      }),
    ),
  );
}
