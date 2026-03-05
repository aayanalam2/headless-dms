import {
  BaseEntity,
  type EntityCreateInput,
  type IEntity,
  type SerializedEntity,
} from "@domain/utils/base.entity.ts";
import type {
  BucketKey,
  Checksum,
  DocumentId,
  UserId,
  VersionId,
} from "@domain/utils/refined.types.ts";

export interface IDocumentVersion extends IEntity<VersionId> {
  readonly documentId: DocumentId;
  readonly versionNumber: number;
  readonly bucketKey: BucketKey;
  readonly sizeBytes: number;
  readonly checksum: Checksum;
  readonly uploadedBy: UserId;
}

export type SerializedDocumentVersion = SerializedEntity<VersionId> & {
  readonly documentId: string;
  readonly versionNumber: number;
  readonly bucketKey: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly uploadedBy: string;
};

export type CreateDocumentVersionInput = EntityCreateInput<IDocumentVersion>;

export class DocumentVersion extends BaseEntity<VersionId> implements IDocumentVersion {
  private constructor(
    id: VersionId,
    createdAt: Date,
    private readonly data: Omit<IDocumentVersion, keyof IEntity<VersionId>>,
  ) {
    // Versions are immutable — updatedAt is always equal to createdAt.
    super(id, createdAt, createdAt);
    Object.freeze(this.data);
  }

  get documentId(): DocumentId {
    return this.data.documentId;
  }

  get versionNumber(): number {
    return this.data.versionNumber;
  }

  /** Fully-qualified S3 object key: `{documentId}/{versionId}/{filename}`. */
  get bucketKey(): BucketKey {
    return this.data.bucketKey;
  }

  /** File size in bytes at time of upload. */
  get sizeBytes(): number {
    return this.data.sizeBytes;
  }

  /** SHA-256 hex digest of the file bytes. */
  get checksum(): Checksum {
    return this.data.checksum;
  }

  /** ID of the user who uploaded this version. */
  get uploadedBy(): UserId {
    return this.data.uploadedBy;
  }

  override _serialize(): SerializedDocumentVersion {
    return {
      ...super._serialize(),
      documentId: this.data.documentId,
      versionNumber: this.data.versionNumber,
      bucketKey: this.data.bucketKey,
      sizeBytes: this.data.sizeBytes,
      checksum: this.data.checksum,
      uploadedBy: this.data.uploadedBy,
    };
  }

  static create(input: CreateDocumentVersionInput): DocumentVersion {
    return new DocumentVersion(input.id, input.createdAt, {
      documentId: input.documentId,
      versionNumber: input.versionNumber,
      bucketKey: input.bucketKey,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum,
      uploadedBy: input.uploadedBy,
    });
  }

  static reconstitute(
    id: VersionId,
    createdAt: Date,
    props: Omit<IDocumentVersion, keyof IEntity<VersionId>>,
  ): DocumentVersion {
    return new DocumentVersion(id, createdAt, props);
  }
}
