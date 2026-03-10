import { Effect as E, Option as O, ParseResult, Schema } from "effect";
import { BaseEntity, type IEntity } from "@domain/utils/base.entity.ts";
import type { DocumentId, UserId, VersionId } from "@domain/utils/refined.types.ts";
import {
  StringToDocumentId,
  StringToUserId,
  StringToVersionId,
} from "@domain/utils/refined.types.ts";
import {
  ContentTypeSchema,
  type ContentType,
} from "@domain/document/value-objects/content-type.vo.ts";
import {
  DocumentAlreadyDeletedError,
  InvalidContentTypeError,
} from "@domain/document/document.errors.ts";

export const DocumentSchema = Schema.Struct({
  id: StringToDocumentId,
  ownerId: StringToUserId,
  name: Schema.String,
  contentType: ContentTypeSchema,
  currentVersionId: Schema.OptionFromNullOr(StringToVersionId),
  tags: Schema.Array(Schema.String),
  metadata: Schema.Record({ key: Schema.String, value: Schema.String }),
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
  deletedAt: Schema.OptionFromNullOr(Schema.DateFromString),
});

export type DocumentType = Schema.Schema.Type<typeof DocumentSchema>;

export type SerializedDocument = Schema.Schema.Encoded<typeof DocumentSchema>;

export interface IDocument extends IEntity<DocumentId> {
  readonly ownerId: UserId;
  readonly name: string;
  readonly contentType: ContentType;
  readonly currentVersionId: O.Option<VersionId>;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly deletedAt: O.Option<Date>;
}

export class Document extends BaseEntity<DocumentId> implements IDocument {
  readonly ownerId: UserId;
  readonly name: string;
  readonly contentType: ContentType;
  readonly currentVersionId: O.Option<VersionId>;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly deletedAt: O.Option<Date>;

  private constructor(data: DocumentType) {
    super(data.id, data.createdAt, data.updatedAt);
    this.ownerId = data.ownerId;
    this.name = data.name;
    this.contentType = data.contentType;
    this.currentVersionId = data.currentVersionId;
    this.tags = [...data.tags];
    this.metadata = { ...data.metadata };
    this.deletedAt = data.deletedAt;
    Object.freeze(this);
  }

  get isDeleted(): boolean {
    return O.isSome(this.deletedAt);
  }

  get hasVersions(): boolean {
    return O.isSome(this.currentVersionId);
  }

  serialized(): E.Effect<SerializedDocument, ParseResult.ParseError> {
    return Schema.encode(DocumentSchema)({
      id: this.id,
      ownerId: this.ownerId,
      name: this.name,
      contentType: this.contentType,
      currentVersionId: this.currentVersionId,
      tags: [...this.tags],
      metadata: { ...this.metadata },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      deletedAt: this.deletedAt,
    });
  }

  static create(input: SerializedDocument): E.Effect<Document, InvalidContentTypeError> {
    return Schema.decodeUnknown(DocumentSchema)(input).pipe(
      E.map((data) => new Document(data)),
      E.mapError(() => new InvalidContentTypeError(input.contentType)),
    );
  }

  static reconstitute(data: DocumentType): Document {
    return new Document(data);
  }

  /**
   * Creates a brand-new Document from already-validated domain values.
   * Intended for use in application-layer workflows where all IDs and
   * primitives are already typed. Only content-type is validated here;
   * all other invariants are enforced by the branded types themselves.
   */
  static createNew(input: {
    readonly id: DocumentId;
    readonly ownerId: UserId;
    readonly name: string;
    readonly contentType: string;
    readonly tags: readonly string[];
    readonly metadata: Record<string, string>;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }): E.Effect<Document, InvalidContentTypeError> {
    if (!Schema.is(ContentTypeSchema)(input.contentType)) {
      return E.fail(new InvalidContentTypeError(input.contentType));
    }
    return E.succeed(
      new Document({
        id: input.id,
        ownerId: input.ownerId,
        name: input.name,
        contentType: input.contentType,
        currentVersionId: O.none(),
        tags: input.tags,
        metadata: input.metadata,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        deletedAt: O.none(),
      }),
    );
  }

  private with(overrides: Partial<DocumentType>): Document {
    return new Document({
      id: this.id,
      ownerId: this.ownerId,
      name: this.name,
      contentType: this.contentType,
      currentVersionId: this.currentVersionId,
      tags: [...this.tags],
      metadata: { ...this.metadata },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      deletedAt: this.deletedAt,
      ...overrides,
    });
  }

  softDelete(now = new Date()): E.Effect<Document, DocumentAlreadyDeletedError> {
    if (this.isDeleted) return E.fail(new DocumentAlreadyDeletedError(this.id));
    return E.succeed(this.with({ deletedAt: O.some(now), updatedAt: now }));
  }

  rename(name: string, now = new Date()): E.Effect<Document, DocumentAlreadyDeletedError> {
    if (this.isDeleted) return E.fail(new DocumentAlreadyDeletedError(this.id));
    return E.succeed(this.with({ name, updatedAt: now }));
  }

  setTags(
    tags: readonly string[],
    now = new Date(),
  ): E.Effect<Document, DocumentAlreadyDeletedError> {
    if (this.isDeleted) return E.fail(new DocumentAlreadyDeletedError(this.id));
    return E.succeed(this.with({ tags: [...tags], updatedAt: now }));
  }

  setCurrentVersion(
    versionId: VersionId,
    now = new Date(),
  ): E.Effect<Document, DocumentAlreadyDeletedError> {
    if (this.isDeleted) return E.fail(new DocumentAlreadyDeletedError(this.id));
    return E.succeed(this.with({ currentVersionId: O.some(versionId), updatedAt: now }));
  }
}
