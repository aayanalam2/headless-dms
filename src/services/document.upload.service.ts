import { type AppResult, AppError, Result } from "../types/errors.ts";
import { DocumentId, VersionId, BucketKey } from "../types/branded.ts";
import {
  createDocument,
  createVersion,
  updateDocument,
  listVersions,
  insertAuditLog,
} from "../models/document.repository.ts";
import { uploadToS3 } from "../models/storage.ts";
import {
  buildBucketKey,
  nextVersionNumber,
  validateContentType,
} from "./document.service.ts";
import { toDocumentDTO, toVersionDTO, type DocumentDTO, type VersionDTO } from "../dto/document.dto.ts";
import type { JwtClaims } from "./auth.service.ts";
import type { DocumentRow } from "../models/db/schema.ts";

// ---------------------------------------------------------------------------
// document.upload.service — async orchestration for file upload flows.
//
// These functions sit between the controller (HTTP parsing) and the
// repositories/storage adapter (I/O). They are intentionally impure —
// they coordinate multiple I/O steps — but they keep that coordination
// out of the controller so handlers stay thin.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// parseOptionalJson
// Shared helper: converts a raw JSON string query param into a typed object.
// Pure, but lives here because it's tightly coupled to upload inputs.
// ---------------------------------------------------------------------------

export function parseOptionalJson(
  raw: string | undefined,
): AppResult<Record<string, string>> {
  if (!raw || raw.trim().length === 0) return Result.Ok({});
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return Result.Err(AppError.validation("metadata must be a JSON object of string values"));
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "string") {
        return Result.Err(AppError.validation(`metadata value for "${k}" must be a string`));
      }
    }
    return Result.Ok(parsed as Record<string, string>);
  } catch {
    return Result.Err(AppError.validation("metadata must be valid JSON"));
  }
}

export function parseTags(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) return [];
  return raw.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// uploadDocument
// Orchestrates the "upload a brand new document" flow:
//   validate → generate IDs → checksum → S3 put → DB insert (doc + version)
//   → promote current version → audit log
// ---------------------------------------------------------------------------

export type UploadDocumentInput = {
  file: File;
  name?: string | undefined;
  rawTags?: string | undefined;
  rawMetadata?: string | undefined;
  userId: string;
};

export type UploadDocumentResult = {
  document: DocumentDTO;
  version: VersionDTO;
};

export async function uploadDocument(
  input: UploadDocumentInput,
): Promise<AppResult<UploadDocumentResult>> {
  // 1. Validate content type
  const ctResult = validateContentType(input.file.type || "application/octet-stream");
  if (ctResult.isErr()) return Result.Err(ctResult.unwrapErr());
  const contentType = ctResult.unwrap();

  // 2. Parse optional fields
  const metaResult = parseOptionalJson(input.rawMetadata);
  if (metaResult.isErr()) return Result.Err(metaResult.unwrapErr());

  // 3. Generate IDs
  const docIdResult = DocumentId.create(crypto.randomUUID());
  const verIdResult = VersionId.create(crypto.randomUUID());
  if (docIdResult.isErr() || verIdResult.isErr()) {
    return Result.Err(AppError.validation("Failed to generate IDs"));
  }
  const docId = docIdResult.unwrap();
  const verId = verIdResult.unwrap();
  const filename = input.name ?? input.file.name ?? "untitled";
  const bucketKey = buildBucketKey(docId, verId, filename);

  // 4. Read file + compute checksum
  const fileBuffer = await input.file.arrayBuffer();
  const checksum = Buffer.from(
    await crypto.subtle.digest("SHA-256", fileBuffer),
  ).toString("hex");

  // 5. Upload to S3
  const uploadResult = await uploadToS3(
    bucketKey,
    Buffer.from(fileBuffer),
    contentType,
  );
  if (uploadResult.isErr()) return Result.Err(uploadResult.unwrapErr());

  // 6. Persist document
  const docResult = await createDocument({
    id: DocumentId.primitive(docId),
    ownerId: input.userId,
    name: filename,
    contentType,
    tags: parseTags(input.rawTags),
    metadata: metaResult.unwrap(),
  });
  if (docResult.isErr()) return Result.Err(docResult.unwrapErr());

  // 7. Persist first version
  const rawVerId = VersionId.primitive(verId);
  const verResult = await createVersion({
    id: rawVerId,
    documentId: DocumentId.primitive(docId),
    versionNumber: 1,
    bucketKey: BucketKey.primitive(bucketKey),
    sizeBytes: fileBuffer.byteLength,
    uploadedBy: input.userId,
    checksum,
  });
  if (verResult.isErr()) return Result.Err(verResult.unwrapErr());

  // 8. Promote version + audit
  const rawDocId = DocumentId.primitive(docId);
  await updateDocument(rawDocId, { currentVersionId: rawVerId, updatedAt: new Date() });
  await insertAuditLog({
    actorId: input.userId,
    action: "document.upload",
    resourceType: "document",
    resourceId: rawDocId,
    metadata: { versionId: rawVerId, filename, contentType },
  });

  return Result.Ok({
    document: toDocumentDTO(docResult.unwrap()),
    version: toVersionDTO(verResult.unwrap()),
  });
}

// ---------------------------------------------------------------------------
// uploadNewVersion
// Orchestrates adding a new version to an existing document.
// ---------------------------------------------------------------------------

export type UploadNewVersionInput = {
  doc: DocumentRow;
  file: File;
  name?: string | undefined;
  actor: JwtClaims;
};

export type UploadNewVersionResult = {
  version: VersionDTO;
};

export async function uploadNewVersion(
  input: UploadNewVersionInput,
): Promise<AppResult<UploadNewVersionResult>> {
  const { doc, file, name, actor } = input;

  // 1. Validate content type
  const ctResult = validateContentType(file.type || doc.contentType);
  if (ctResult.isErr()) return Result.Err(ctResult.unwrapErr());
  const contentType = ctResult.unwrap();

  // 2. Determine next version number
  const versionsResult = await listVersions(doc.id);
  if (versionsResult.isErr()) return Result.Err(versionsResult.unwrapErr());

  // 3. Generate IDs
  const docIdResult = DocumentId.create(doc.id);
  const verIdResult = VersionId.create(crypto.randomUUID());
  if (docIdResult.isErr() || verIdResult.isErr()) {
    return Result.Err(AppError.validation("Invalid document ID"));
  }
  const docId = docIdResult.unwrap();
  const verId = verIdResult.unwrap();
  const filename = name ?? file.name ?? doc.name;
  const bucketKey = buildBucketKey(docId, verId, filename);

  // 4. Read file + checksum
  const fileBuffer = await file.arrayBuffer();
  const checksum = Buffer.from(
    await crypto.subtle.digest("SHA-256", fileBuffer),
  ).toString("hex");

  // 5. Upload to S3
  const uploadResult = await uploadToS3(
    bucketKey,
    Buffer.from(fileBuffer),
    contentType,
  );
  if (uploadResult.isErr()) return Result.Err(uploadResult.unwrapErr());

  // 6. Persist version
  const rawVerId = VersionId.primitive(verId);
  const rawDocId = DocumentId.primitive(docId);
  const versionNumber = nextVersionNumber(versionsResult.unwrap());
  const verResult = await createVersion({
    id: rawVerId,
    documentId: rawDocId,
    versionNumber,
    bucketKey: BucketKey.primitive(bucketKey),
    sizeBytes: fileBuffer.byteLength,
    uploadedBy: actor.userId,
    checksum,
  });
  if (verResult.isErr()) return Result.Err(verResult.unwrapErr());

  // 7. Promote + audit
  await updateDocument(rawDocId, { currentVersionId: rawVerId, updatedAt: new Date() });
  await insertAuditLog({
    actorId: actor.userId,
    action: "document.version.create",
    resourceType: "document",
    resourceId: rawDocId,
    metadata: { versionId: rawVerId, versionNumber, filename },
  });

  return Result.Ok({ version: toVersionDTO(verResult.unwrap()) });
}
