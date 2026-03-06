import { BucketKey } from "@domain/utils/refined.types.ts";

/**
 * Factory for the BucketKey value object.
 *
 * Encodes the canonical storage addressing rule for a document version:
 *   {documentId}/{versionId}/{encodedFilename}
 *
 * Keeping this rule in the domain ensures that the storage key structure is
 * a named, auditable invariant rather than an inline string template scattered
 * across the application layer.
 */
export const BucketKeyFactory = {
  forVersion(documentId: string, versionId: string, filename: string): BucketKey {
    return BucketKey.create(
      `${documentId}/${versionId}/${encodeURIComponent(filename)}`,
    ).unwrap();
  },
} as const;
