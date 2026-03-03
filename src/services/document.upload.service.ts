import { Effect, Option } from "effect";
import { AppError } from "../types/errors.ts";
import { DocumentId, VersionId, BucketKey } from "../types/branded.ts";
import { AuditAction, AuditResourceType } from "../types/enums.ts";
import {
  createDocument,
  createVersion,
  updateDocument,
  listVersions,
  insertAuditLog,
} from "../models/document.repository.ts";
import { uploadToS3 } from "../models/storage.ts";
import { buildBucketKey, nextVersionNumber, validateContentType } from "./document.service.ts";
import {
  toDocumentDTO,
  toVersionDTO,
  type DocumentDTO,
  type VersionDTO,
} from "../dto/document.dto.ts";
import type { JwtClaims } from "./auth.service.ts";
import type { DocumentRow } from "../models/db/schema.ts";

function fromRefined<T>(r: { isOk(): boolean; unwrap(): T }): Effect.Effect<T, AppError> {
  return r.isOk()
    ? Effect.succeed(r.unwrap())
    : Effect.fail(AppError.validation("Failed to generate IDs"));
}

// ---------------------------------------------------------------------------
// parseOptionalJson
// ---------------------------------------------------------------------------

export function parseOptionalJson(
  raw: Option.Option<string>,
): Effect.Effect<Record<string, string>, AppError> {
  if (Option.isNone(raw) || raw.value.trim().length === 0) return Effect.succeed({});
  const str = raw.value;
  return Effect.try({
    try: () => {
      const parsed: unknown = JSON.parse(str);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw AppError.validation("metadata must be a JSON object of string values");
      }
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== "string") {
          throw AppError.validation(`metadata value for "${k}" must be a string`);
        }
      }
      return parsed as Record<string, string>;
    },
    catch: (e) => {
      if (e !== null && typeof e === "object" && "tag" in e) return e as AppError;
      return AppError.validation("metadata must be valid JSON");
    },
  });
}

export function parseTags(raw: Option.Option<string>): string[] {
  if (Option.isNone(raw) || raw.value.trim().length === 0) return [];
  return raw.value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// uploadDocument
// ---------------------------------------------------------------------------

export type UploadDocumentInput = {
  file: File;
  name: Option.Option<string>;
  rawTags: Option.Option<string>;
  rawMetadata: Option.Option<string>;
  userId: string;
};

export type UploadDocumentResult = {
  document: DocumentDTO;
  version: VersionDTO;
};

export function uploadDocument(
  input: UploadDocumentInput,
): Effect.Effect<UploadDocumentResult, AppError> {
  return Effect.gen(function* () {
    const contentType = yield* validateContentType(input.file.type || "application/octet-stream");
    const metadata = yield* parseOptionalJson(input.rawMetadata);

    const docId = yield* fromRefined(DocumentId.create(crypto.randomUUID()));
    const verId = yield* fromRefined(VersionId.create(crypto.randomUUID()));
    const filename = Option.getOrElse(input.name, () => input.file.name ?? "untitled");
    const bucketKey = buildBucketKey(docId, verId, filename);

    const fileBuffer = yield* Effect.promise(() => input.file.arrayBuffer());
    const hashBuffer = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", fileBuffer));
    const checksum = Buffer.from(hashBuffer).toString("hex");

    yield* uploadToS3(bucketKey, Buffer.from(fileBuffer), contentType);

    const rawDocId = DocumentId.primitive(docId);
    const doc = yield* createDocument({
      id: rawDocId,
      ownerId: input.userId,
      name: filename,
      contentType,
      tags: parseTags(input.rawTags),
      metadata,
    });

    const rawVerId = VersionId.primitive(verId);
    const version = yield* createVersion({
      id: rawVerId,
      documentId: rawDocId,
      versionNumber: 1,
      bucketKey: BucketKey.primitive(bucketKey),
      sizeBytes: fileBuffer.byteLength,
      uploadedBy: input.userId,
      checksum,
    });

    yield* Effect.ignoreLogged(
      updateDocument(rawDocId, { currentVersionId: rawVerId, updatedAt: new Date() }),
    );
    yield* Effect.ignoreLogged(
      insertAuditLog({
        actorId: input.userId,
        action: AuditAction.DocumentUpload,
        resourceType: AuditResourceType.Document,
        resourceId: rawDocId,
        metadata: { versionId: rawVerId, filename, contentType },
      }),
    );

    return { document: toDocumentDTO(doc), version: toVersionDTO(version) };
  });
}

// ---------------------------------------------------------------------------
// uploadNewVersion
// ---------------------------------------------------------------------------

export type UploadNewVersionInput = {
  doc: DocumentRow;
  file: File;
  name: Option.Option<string>;
  actor: JwtClaims;
};

export type UploadNewVersionResult = {
  version: VersionDTO;
};

export function uploadNewVersion(
  input: UploadNewVersionInput,
): Effect.Effect<UploadNewVersionResult, AppError> {
  const { doc, file, name, actor } = input;

  return Effect.gen(function* () {
    const contentType = yield* validateContentType(file.type || doc.contentType);
    const versions = yield* listVersions(doc.id);

    const docId = yield* fromRefined(DocumentId.create(doc.id));
    const verId = yield* fromRefined(VersionId.create(crypto.randomUUID()));
    const filename = Option.getOrElse(name, () => file.name ?? doc.name);
    const bucketKey = buildBucketKey(docId, verId, filename);

    const fileBuffer = yield* Effect.promise(() => file.arrayBuffer());
    const hashBuffer = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", fileBuffer));
    const checksum = Buffer.from(hashBuffer).toString("hex");

    yield* uploadToS3(bucketKey, Buffer.from(fileBuffer), contentType);

    const rawVerId = VersionId.primitive(verId);
    const rawDocId = DocumentId.primitive(docId);
    const versionNumber = nextVersionNumber(versions);

    const version = yield* createVersion({
      id: rawVerId,
      documentId: rawDocId,
      versionNumber,
      bucketKey: BucketKey.primitive(bucketKey),
      sizeBytes: fileBuffer.byteLength,
      uploadedBy: actor.userId,
      checksum,
    });

    yield* Effect.ignoreLogged(
      updateDocument(rawDocId, { currentVersionId: rawVerId, updatedAt: new Date() }),
    );
    yield* Effect.ignoreLogged(
      insertAuditLog({
        actorId: actor.userId,
        action: AuditAction.DocumentVersionCreate,
        resourceType: AuditResourceType.Document,
        resourceId: rawDocId,
        metadata: { versionId: rawVerId, versionNumber, filename },
      }),
    );

    return { version: toVersionDTO(version) };
  });
}
