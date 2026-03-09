import { Schema as S } from "effect";
import type { DocumentId, VersionId } from "@domain/utils/refined.types.ts";
import { BucketKey, StringToBucketKey } from "@domain/utils/refined.types.ts";

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
  forVersion(documentId: DocumentId, versionId: VersionId, filename: string): BucketKey {
    return S.decodeSync(StringToBucketKey)(
      `${String(documentId)}/${String(versionId)}/${encodeURIComponent(filename)}`,
    );
  },
} as const;
