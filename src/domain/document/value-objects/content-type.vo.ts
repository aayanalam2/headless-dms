import { Schema } from "effect";

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
