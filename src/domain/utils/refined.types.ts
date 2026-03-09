import { createRefinedType } from "@carbonteq/refined-type";
import { ParseResult, Schema } from "effect";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Refined scalar types for the domain layer.
//
// All domain IDs and validated primitives are represented as branded types
// using `@carbonteq/refined-type`. This makes it structurally impossible to
// pass a raw string where a typed domain value is expected — caught at compile
// time, not at runtime.
//
// Usage (domain code):
//   const id = DocumentId.create(rawString);   // Result<DocumentId, RefinedValidationError>
//   if (id.isOk()) useDoc(id.unwrap());
//
// Usage (persistence / factories):
//   const id = DocumentId.create(row.id).unwrap(); // safe after DB read
//   const raw = DocumentId.primitive(id);           // string for query params
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// UUID — base branded type for all entity primary keys
// ---------------------------------------------------------------------------

/** General-purpose UUID. Used as the base for all entity ID types. */
export const UUID = createRefinedType("UUID", z.uuid());
export type UUID = typeof UUID.$infer;

// ---------------------------------------------------------------------------
// Domain-specific ID types
//
// Separate brands prevent accidentally passing a UserId where a DocumentId is
// expected, even though both are structurally identical UUID strings.
// ---------------------------------------------------------------------------

export const DocumentId = createRefinedType("DocumentId", z.uuid());
export type DocumentId = typeof DocumentId.$infer;

export const VersionId = createRefinedType("VersionId", z.uuid());
export type VersionId = typeof VersionId.$infer;

export const UserId = createRefinedType("UserId", z.uuid());
export type UserId = typeof UserId.$infer;

export const AccessPolicyId = createRefinedType("AccessPolicyId", z.uuid());
export type AccessPolicyId = typeof AccessPolicyId.$infer;

// ---------------------------------------------------------------------------
// Validated string types
// ---------------------------------------------------------------------------

/** RFC-5322 email address (local@domain.tld). */
export const Email = createRefinedType("Email", z.email());
export type Email = typeof Email.$infer;

/**
 * Non-empty hashed password string.
 * Prevents accidentally passing plaintext where a bcrypt hash is expected.
 */
export const HashedPassword = createRefinedType("HashedPassword", z.string().min(1));
export type HashedPassword = typeof HashedPassword.$infer;

/**
 * S3 object key — must be non-empty.
 * Format: {documentId}/{versionId}/{encodedFilename}
 */
export const BucketKey = createRefinedType("BucketKey", z.string().min(1));
export type BucketKey = typeof BucketKey.$infer;

/**
 * SHA-256 hex digest — exactly 64 lowercase hexadecimal characters.
 * Stored alongside each document version for integrity verification.
 */
export const Checksum = createRefinedType(
  "Checksum",
  z.string().regex(/^[a-f0-9]{64}$/, "Checksum must be a 64-character lowercase hex string"),
);
export type Checksum = typeof Checksum.$infer;

// ---------------------------------------------------------------------------
// Effect Schema transforms
// ---------------------------------------------------------------------------

/**
 * Internal factory: creates an Effect Schema transform backed by a
 * `@carbonteq/refined-type` factory.
 *   Encoded = plain `string`
 *   Type    = the factory's branded type (e.g. DocumentId, Email …)
 * All validation is delegated to the factory's own Zod schema.
 */
function makeRefinedSchema<T extends string>(factory: {
  create: (s: string) => { isOk(): boolean; unwrap(): T };
}) {
  return Schema.transformOrFail(
    Schema.String,
    Schema.String as unknown as Schema.Schema<T, string>,
    {
      strict: false,
      decode: (value, _, ast) => {
        const result = factory.create(value);
        return result.isOk()
          ? ParseResult.succeed(result.unwrap())
          : ParseResult.fail(new ParseResult.Type(ast, value, "Validation failed"));
      },
      encode: (id) => ParseResult.succeed(id as unknown as string),
    },
  );
}

// UUID-based ID schemas
export const StringToDocumentId = makeRefinedSchema(DocumentId);
export const StringToVersionId = makeRefinedSchema(VersionId);
export const StringToUserId = makeRefinedSchema(UserId);
export const StringToAccessPolicyId = makeRefinedSchema(AccessPolicyId);

export const newDocumentId = (): DocumentId => DocumentId.create(crypto.randomUUID()).unwrap();
export const newVersionId = (): VersionId => VersionId.create(crypto.randomUUID()).unwrap();
export const newUserId = (): UserId => UserId.create(crypto.randomUUID()).unwrap();
export const newAccessPolicyId = (): AccessPolicyId => AccessPolicyId.create(crypto.randomUUID()).unwrap();

// Other validated-string schemas
export const StringToEmail = makeRefinedSchema(Email);
export const StringToHashedPassword = makeRefinedSchema(HashedPassword);
export const StringToBucketKey = makeRefinedSchema(BucketKey);
export const StringToChecksum = makeRefinedSchema(Checksum);
