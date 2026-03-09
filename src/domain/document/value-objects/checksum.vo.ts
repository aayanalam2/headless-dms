import { Effect as E, Schema as S } from "effect";
import { Checksum, StringToChecksum } from "@domain/utils/refined.types.ts";

/**
 * Factory for the Checksum value object.
 *
 * The canonical checksum algorithm is SHA-256, producing a 64-character
 * lowercase hex digest (as enforced by the `Checksum` refined type).
 * Encoding the algorithm here means the domain owns the decision — callers
 * never need to know which hash function to use.
 */
export const ChecksumFactory = {
  fromBuffer(buf: ArrayBuffer): E.Effect<Checksum, never> {
    return E.promise(() => crypto.subtle.digest("SHA-256", buf)).pipe(
      E.map((hash) => S.decodeSync(StringToChecksum)(Buffer.from(hash).toString("hex"))),
    );
  },
} as const;
