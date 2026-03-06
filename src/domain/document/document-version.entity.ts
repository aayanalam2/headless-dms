import { Effect, ParseResult, Schema } from "effect";
import { BaseEntity, type IEntity } from "@domain/utils/base.entity.ts";
import type {
  BucketKey,
  Checksum,
  DocumentId,
  UserId,
  VersionId,
} from "@domain/utils/refined.types.ts";
import {
  StringToBucketKey,
  StringToChecksum,
  StringToDocumentId,
  StringToUserId,
  StringToVersionId,
} from "@domain/utils/refined.types.ts";

// ---------------------------------------------------------------------------
// DocumentVersionSchema
//
//   Encoded (wire)  →  Type (domain)
//   string (UUID)   →  VersionId / DocumentId / UserId  (branded)
//   string          →  BucketKey / Checksum             (branded)
//   number          →  number                           (pass-through)
//   string (ISO)    →  Date
// ---------------------------------------------------------------------------

export const DocumentVersionSchema = Schema.Struct({
  id: StringToVersionId,
  documentId: StringToDocumentId,
  versionNumber: Schema.Number,
  bucketKey: StringToBucketKey,
  sizeBytes: Schema.Number,
  checksum: StringToChecksum,
  uploadedBy: StringToUserId,
  createdAt: Schema.DateFromString,
});

/** Domain form — branded IDs, Date. */
export type DocumentVersionType = Schema.Schema.Type<typeof DocumentVersionSchema>;

/** Wire / persistence form — plain strings, ISO date. */
export type SerializedDocumentVersion = Schema.Schema.Encoded<typeof DocumentVersionSchema>;

// ---------------------------------------------------------------------------
// Domain interface
// ---------------------------------------------------------------------------

export interface IDocumentVersion extends IEntity<VersionId> {
  readonly documentId: DocumentId;
  readonly versionNumber: number;
  readonly bucketKey: BucketKey;
  readonly sizeBytes: number;
  readonly checksum: Checksum;
  readonly uploadedBy: UserId;
}

// ---------------------------------------------------------------------------
// DocumentVersion entity class
// ---------------------------------------------------------------------------

export class DocumentVersion extends BaseEntity<VersionId> implements IDocumentVersion {
  readonly documentId: DocumentId;
  readonly versionNumber: number;
  readonly bucketKey: BucketKey;
  readonly sizeBytes: number;
  readonly checksum: Checksum;
  readonly uploadedBy: UserId;

  private constructor(data: DocumentVersionType) {
    // Versions are immutable — updatedAt is always equal to createdAt.
    super(data.id, data.createdAt, data.createdAt);
    this.documentId = data.documentId;
    this.versionNumber = data.versionNumber;
    this.bucketKey = data.bucketKey;
    this.sizeBytes = data.sizeBytes;
    this.checksum = data.checksum;
    this.uploadedBy = data.uploadedBy;
    Object.freeze(this);
  }

  serialized(): Effect.Effect<SerializedDocumentVersion, ParseResult.ParseError> {
    return Schema.encode(DocumentVersionSchema)({
      id: this.id,
      documentId: this.documentId,
      versionNumber: this.versionNumber,
      bucketKey: this.bucketKey,
      sizeBytes: this.sizeBytes,
      checksum: this.checksum,
      uploadedBy: this.uploadedBy,
      createdAt: this.createdAt,
    });
  }

  static create(
    input: SerializedDocumentVersion,
  ): Effect.Effect<DocumentVersion, ParseResult.ParseError> {
    return Schema.decodeUnknown(DocumentVersionSchema)(input).pipe(
      Effect.map((data) => new DocumentVersion(data)),
    );
  }

  static reconstitute(data: DocumentVersionType): DocumentVersion {
    return new DocumentVersion(data);
  }

  // equals() is inherited from BaseEntity — identity by id.
}
