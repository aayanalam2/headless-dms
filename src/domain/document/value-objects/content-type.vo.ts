import { Schema } from "effect";

// ---------------------------------------------------------------------------
// ContentType value object
//
// Represents a validated MIME type accepted by the document upload pipeline.
// Using Schema.Literal produces a closed union so the compiler will catch any
// unsupported MIME type at the boundary where user input is decoded.
//
// Design notes:
//   • Value object — identified by its value, not an ID.
//   • Encoded form (DB / wire) is a plain string; decoded form is a branded
//     literal union — encode/decode round-trip is an identity for valid values.
//   • Adding a new MIME type is a one-line change to ALLOWED_MIME_TYPES.
// ---------------------------------------------------------------------------

/**
 * The exhaustive set of MIME types the system accepts.
 * Declared `as const` so the element type is a tuple of string literals,
 * which Schema.Literal can spread into a union.
 */
export const ALLOWED_MIME_TYPES = [
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Text
  "text/plain",
  "text/csv",
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

/**
 * Schema that accepts only the allowed MIME type strings.
 *
 * Decode: raw string ──▶ one of the literal union members (or ParseError)
 * Encode: literal union member ──▶ identical string (identity)
 */
export const ContentTypeSchema = Schema.Literal(...ALLOWED_MIME_TYPES);

/** The domain type for a validated content/MIME type. */
export type ContentType = typeof ContentTypeSchema.Type;
