// ---------------------------------------------------------------------------
// BaseEntity and IEntity — domain layer foundations.
//
// Every aggregate root and entity that participates in the full lifecycle
// (create → mutate → delete) extends BaseEntity.
//
// Design:
//   • IEntity<TId>: Minimal interface contract — id, createdAt, updatedAt.
//   • SerializedEntity<TId>: Persistence/wire representation — all dates as
//     ISO-8601 strings, id kept as branded string.
//   • BaseEntity<TId>: Abstract class implementing IEntity.  Provides:
//       - Constructor that accepts and freezes base fields.
//       - _serialize(): SerializedEntity — converts dates to ISO strings.
//       - static _fromSerialized(): parses ISO strings back to Dates.
//       - equals(): identity comparison by id.
//
// Subclasses override _serialize() to include domain-specific fields and
// call _fromSerialized() inside their reconstitute() static factories.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// IEntity — the minimal entity contract
// ---------------------------------------------------------------------------

/**
 * Every entity must expose an id, a creation timestamp, and an updated-at
 * timestamp.  `TId` is kept generic so subclasses can narrow to their own
 * branded ID types (e.g. `DocumentId`) while remaining assignable to the
 * base interface.
 */
export interface IEntity<TId extends string = string> {
  readonly id: TId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ---------------------------------------------------------------------------
// SerializedEntity — persistence / wire-transfer shape
// ---------------------------------------------------------------------------

/**
 * Flattened, JSON-safe representation of base entity fields.
 * Dates are stored as ISO-8601 strings; IDs remain branded for type safety
 * across the persistence boundary.
 *
 * Subclass serialized types extend this and add their own fields.
 */
export type SerializedEntity<TId extends string = string> = {
  readonly id: TId;
  readonly createdAt: string;
  readonly updatedAt: string;
};

// ---------------------------------------------------------------------------
// BaseEntity — abstract base class
// ---------------------------------------------------------------------------

/**
 * Abstract base for all lifecycle entities.
 *
 * Subclasses MUST:
 *   1. Have a private constructor that calls `super(id, createdAt, updatedAt)`.
 *   2. Expose only a static `create()` factory (validated) and
 *      `reconstitute()` factory (trusted, from persistence).
 *   3. Override `_serialize()` to include domain-specific fields.
 */
// ---------------------------------------------------------------------------
// EntityCreateInput — generic "create" input helper
// ---------------------------------------------------------------------------

/**
 * Derives the input shape for an entity's `create()` factory from its
 * interface.
 *
 * Strips `updatedAt` from the entity interface (it is always equal to
 * `createdAt` on initial creation and is therefore not required from the
 * caller).  `id` and `createdAt` are kept because callers supply them
 * (useful for deterministic tests and workflow-generated IDs).
 *
 * When a concrete field needs to accept a raw/unvalidated type (e.g.
 * `contentType: string` instead of the branded `ContentType`), override it
 * with an intersection:
 *
 * ```ts
 * type CreateDocumentInput =
 *   Omit<EntityCreateInput<IDocument>, 'contentType'> &
 *   { readonly contentType: string };
 * ```
 */
export type EntityCreateInput<T extends IEntity<string>> = Omit<T, "updatedAt">;

export abstract class BaseEntity<TId extends string = string> implements IEntity<TId> {
  constructor(
    readonly id: TId,
    readonly createdAt: Date,
    readonly updatedAt: Date,
  ) {}

  // -------------------------------------------------------------------------
  // Serialization helpers
  // -------------------------------------------------------------------------

  /**
   * Converts base entity fields to their serialized (persistence/wire) form.
   *
   * Subclasses should override this method and spread the result of
   * `super._serialize()` into their own richer serialized type:
   *
   * ```ts
   * override _serialize(): SerializedDocument {
   *   return {
   *     ...super._serialize(),
   *     name: this.name,
   *     // … other fields …
   *   };
   * }
   * ```
   */
  _serialize(): SerializedEntity<TId> {
    return {
      id: this.id,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Parses the base entity fields from a serialized record.
   *
   * Intended to be called inside subclass `reconstitute()` static factories:
   *
   * ```ts
   * static reconstitute(data: SerializedDocument): Document {
   *   const base = Document._fromSerialized(data);
   *   return new Document(base.id, base.createdAt, base.updatedAt, { … });
   * }
   * ```
   */
  protected static _fromSerialized<TId extends string>(
    data: Pick<SerializedEntity<TId>, "id" | "createdAt" | "updatedAt">,
  ): { id: TId; createdAt: Date; updatedAt: Date } {
    return {
      id: data.id,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  // -------------------------------------------------------------------------
  // Equality — identity semantics
  // -------------------------------------------------------------------------

  /**
   * Two entity instances are equal when their IDs match, regardless of
   * the state of other fields.
   */
  equals(other: IEntity<TId>): boolean {
    return this.id === other.id;
  }
}
