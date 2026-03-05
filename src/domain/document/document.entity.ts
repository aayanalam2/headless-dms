import { Either, Option, Schema } from "effect";
import { BaseEntity, type EntityCreateInput, type IEntity, type SerializedEntity } from "@domain/utils/base.entity.ts";
import type { DocumentId, UserId, VersionId } from "@domain/utils/refined.types.ts";
import { normalizeMaybe, optionToMaybe, type Maybe } from "@domain/utils/utils.ts";
import { ContentTypeSchema, type ContentType } from "@domain/document/value-objects/content-type.vo.ts";
import {
  DocumentAlreadyDeletedError,
  InvalidContentTypeError,
} from "@domain/document/document.errors.ts";

export interface IDocument extends IEntity<DocumentId> {
  readonly ownerId: UserId;
  readonly name: string;
  readonly contentType: ContentType;
  readonly currentVersionId: Option.Option<VersionId>;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly deletedAt: Option.Option<Date>;
}

export type SerializedDocument = SerializedEntity<DocumentId> & {
  readonly ownerId: string;
  readonly name: string;
  readonly contentType: string;
  readonly currentVersionId: Maybe<string>;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly deletedAt: Maybe<string>;
}
// ---------------------------------------------------------------------------
// Factory input
// ---------------------------------------------------------------------------

/**
 * Input for Document.create().  Derived from IDocument via EntityCreateInput
 * (which drops `updatedAt`), with `contentType` overridden to accept a raw
 * string that will be validated against ContentTypeSchema inside create().
 */
/**
 * Optional fields accept `Maybe<T>` (i.e. `Option<T> | null | undefined`) so
 * callers from any layer — application services, tests, repository adapters —
 * can pass whatever shape they naturally have.  `create()` normalizes them to
 * `Option<T>` via `normalizeMaybe` before storing them in the entity.
 */
export type CreateDocumentInput =
  Omit<EntityCreateInput<IDocument>, "contentType" | "currentVersionId" | "deletedAt"> & {
    readonly contentType: string;
    readonly currentVersionId: Maybe<VersionId>;
    readonly deletedAt: Maybe<Date>;
  };

export class Document extends BaseEntity<DocumentId> implements IDocument {
  private constructor(
    id: DocumentId,
    createdAt: Date,
    updatedAt: Date,
    private readonly data: Omit<IDocument, keyof IEntity<DocumentId>>,
  ) {
    super(id, createdAt, updatedAt);
    Object.freeze(this.data);
  }

  get ownerId(): UserId {
    return this.data.ownerId;
  }

  get name(): string {
    return this.data.name;
  }

  get contentType(): ContentType {
    return this.data.contentType;
  }

  get currentVersionId(): Option.Option<VersionId> {
    return this.data.currentVersionId;
  }

  get tags(): readonly string[] {
    return this.data.tags;
  }

  get metadata(): Readonly<Record<string, string>> {
    return this.data.metadata;
  }

  /** `Option.none()` while active; `Option.some(date)` after soft-deletion. */
  get deletedAt(): Option.Option<Date> {
    return this.data.deletedAt;
  }

  /** Convenience boolean — `true` when `deletedAt` is `Some`. */
  get isDeleted(): boolean {
    return Option.isSome(this.data.deletedAt);
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /**
   * Converts this document to its persistence/wire representation.
   * Spreads base entity fields (id, createdAt, updatedAt as ISO strings)
   * then adds document-specific fields, converting Option → null|string.
   */
  override _serialize(): SerializedDocument {
    return {
      ...super._serialize(),
      ownerId: this.data.ownerId,
      name: this.data.name,
      contentType: this.data.contentType,
      currentVersionId: optionToMaybe(this.data.currentVersionId) as Maybe<string>,
      tags: this.data.tags,
      metadata: this.data.metadata,
      deletedAt: optionToMaybe(Option.map(this.data.deletedAt, (d) => d.toISOString())),
    };
  }

  // -------------------------------------------------------------------------
  // Static factory — Document.create (validated)
  // -------------------------------------------------------------------------

  /**
   * Creates a new, active Document.
   *
   * Validates `contentType` against the allowed MIME-type list via
   * `ContentTypeSchema`.  Returns the entity on success or
   * `InvalidContentTypeError` when the MIME type is not permitted.
   *
   * No I/O — fully pure.
   */
  static create(input: CreateDocumentInput): Document | InvalidContentTypeError {
    const ctResult = Schema.decodeUnknownEither(ContentTypeSchema)(input.contentType);

    if (Either.isLeft(ctResult)) {
      return new InvalidContentTypeError(input.contentType);
    }

    return new Document(
      input.id,
      input.createdAt,
      input.createdAt,
      {
        ownerId: input.ownerId,
        name: input.name,
        contentType: ctResult.right,
        currentVersionId: normalizeMaybe(input.currentVersionId),
        tags: input.tags,
        metadata: input.metadata,
        deletedAt: normalizeMaybe(input.deletedAt),
      },
    );
  }

  /**
   * Reconstructs a Document from already-validated, branded props.
   *
   * The repository adapter decodes raw DB column values into branded types
   * (via `XxxId.create(row.id).unwrap()`) before calling this.  No
   * re-validation is performed here.
   */
  static reconstitute(
    id: DocumentId,
    createdAt: Date,
    updatedAt: Date,
    props: Omit<IDocument, keyof IEntity<DocumentId>>,
  ): Document {
    return new Document(id, createdAt, updatedAt, props);
  }

  /**
   * Marks the document as soft-deleted.
   * Returns `DocumentAlreadyDeletedError` if already deleted.
   */
  softDelete(now = new Date()): Document | DocumentAlreadyDeletedError {
    if (this.isDeleted) {
      return new DocumentAlreadyDeletedError(this.id);
    }
    return new Document(this.id, this.createdAt, now, {
      ...this.data,
      deletedAt: Option.some(now),
    });
  }

  /**
   * Returns a new Document with the given name.
   * Returns `DocumentAlreadyDeletedError` if the document has been deleted.
   */
  rename(name: string, now = new Date()): Document | DocumentAlreadyDeletedError {
    if (this.isDeleted) {
      return new DocumentAlreadyDeletedError(this.id);
    }
    return new Document(this.id, this.createdAt, now, { ...this.data, name });
  }

  /**
   * Returns a new Document with the supplied tag list (replaces existing tags).
   * Returns `DocumentAlreadyDeletedError` if the document has been deleted.
   */
  setTags(
    tags: readonly string[],
    now = new Date(),
  ): Document | DocumentAlreadyDeletedError {
    if (this.isDeleted) {
      return new DocumentAlreadyDeletedError(this.id);
    }
    return new Document(this.id, this.createdAt, now, { ...this.data, tags });
  }

  /**
   * Returns a new Document with `currentVersionId` set to `Option.some(id)`.
   * Returns `DocumentAlreadyDeletedError` if the document has been deleted.
   */
  setCurrentVersion(
    versionId: VersionId,
    now = new Date(),
  ): Document | DocumentAlreadyDeletedError {
    if (this.isDeleted) {
      return new DocumentAlreadyDeletedError(this.id);
    }
    return new Document(this.id, this.createdAt, now, {
      ...this.data,
      currentVersionId: Option.some(versionId),
    });
  }
}
