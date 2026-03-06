import { Effect as E, ParseResult, Schema } from "effect";
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

export type DocumentVersionType = Schema.Schema.Type<typeof DocumentVersionSchema>;

export type SerializedDocumentVersion = Schema.Schema.Encoded<typeof DocumentVersionSchema>;

export interface IDocumentVersion extends IEntity<VersionId> {
  readonly documentId: DocumentId;
  readonly versionNumber: number;
  readonly bucketKey: BucketKey;
  readonly sizeBytes: number;
  readonly checksum: Checksum;
  readonly uploadedBy: UserId;
}

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

  serialized(): E.Effect<SerializedDocumentVersion, ParseResult.ParseError> {
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
  ): E.Effect<DocumentVersion, ParseResult.ParseError> {
    return Schema.decodeUnknown(DocumentVersionSchema)(input).pipe(
      E.map((data) => new DocumentVersion(data)),
    );
  }

  static reconstitute(data: DocumentVersionType): DocumentVersion {
    return new DocumentVersion(data);
  }
}
