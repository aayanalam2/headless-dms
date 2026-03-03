import { createRefinedType } from "@carbonteq/refined-type";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Branded primitive types for the domain layer.
//
// All domain IDs and validated primitives are represented as branded types.
// This makes it structurally impossible to pass a raw string where a typed
// domain value is required — caught at compile time, not at runtime.
//
// Usage:
//   const result = UserId.create(someString);   // Result<UserId, ValidationError>
//   if (result.isOk()) {
//     doSomethingWith(result.unwrap());          // typed as UserId
//   }
//
// To get the underlying primitive back:
//   UserId.primitive(userId)                     // string
// ---------------------------------------------------------------------------

// UUID-shaped string — used for all entity primary keys
const uuidSchema = z.uuid();

export const UserId = createRefinedType("UserId", uuidSchema);
export type UserId = typeof UserId.$infer;

export const DocumentId = createRefinedType("DocumentId", uuidSchema);
export type DocumentId = typeof DocumentId.$infer;

export const VersionId = createRefinedType("VersionId", uuidSchema);
export type VersionId = typeof VersionId.$infer;

export const Email = createRefinedType("Email", z.email());
export type Email = typeof Email.$infer;

// Non-empty string that has already been hashed — prevents accidentally
// storing a plaintext password where a hash is expected.
export const HashedPassword = createRefinedType(
  "HashedPassword",
  z.string().min(1),
);
export type HashedPassword = typeof HashedPassword.$infer;

// S3 object key — must be non-empty
export const BucketKey = createRefinedType("BucketKey", z.string().min(1));
export type BucketKey = typeof BucketKey.$infer;

// Document filename — 1..255 chars
export const FileName = createRefinedType(
  "FileName",
  z.string().min(1).max(255),
);
export type FileName = typeof FileName.$infer;

// RBAC roles
export const ROLES = ["admin", "user"] as const;
export type Role = (typeof ROLES)[number];

// ---------------------------------------------------------------------------
// ISODateString
// A branded string that has been validated (or produced from) an ISO-8601
// date-time. Two construction paths:
//
//   ISODateString.fromDate(date)   — always safe; Date.toISOString() is always
//                                    valid ISO-8601. Used inside DTOs.
//
//   ISODateString.create(str)      — validates external input and returns an
//                                    Effect-compatible Result. Use when the
//                                    string originates from user input.
// ---------------------------------------------------------------------------

const _ISODateStringRefined = createRefinedType(
  "ISODateString",
  z.string().datetime({ offset: true }),
);

export const ISODateString = Object.assign(_ISODateStringRefined, {
  /** Safely coerce a Date — toISOString() always produces valid ISO-8601. */
  fromDate: (date: Date): ISODateString => date.toISOString() as ISODateString,
});

export type ISODateString = typeof ISODateString.$infer;
