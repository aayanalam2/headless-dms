import { Effect as E } from "effect";
import { InvalidMetadataError } from "@domain/document/document.errors.ts";

/**
 * Metadata value object.
 *
 * Invariants:
 *  - Metadata is a flat JSON object where every value is a string.
 *  - An absent or empty raw value yields an empty Metadata instance.
 *  - The value object is immutable.
 */
export class Metadata {
  private constructor(readonly value: Readonly<Record<string, string>>) {
    Object.freeze(this);
  }

  static empty(): Metadata {
    return new Metadata({});
  }

  /**
   * Wrap an already-validated record (e.g. from persistence).
   */
  static from(record: Readonly<Record<string, string>>): Metadata {
    return new Metadata({ ...record });
  }

  /**
   * Parse and validate a raw JSON string into a Metadata instance.
   * Fails with `InvalidMetadataError` when the input is present but either
   * not a JSON object or contains non-string values.
   */
  static parse(raw: string | null | undefined): E.Effect<Metadata, InvalidMetadataError> {
    if (!raw || raw.trim().length === 0) return E.succeed(Metadata.empty());
    return E.try({
      try: () => {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("metadata must be a JSON object of string values");
        }
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v !== "string") {
            throw new Error(`metadata value for "${k}" must be a string`);
          }
        }
        return new Metadata(parsed as Record<string, string>);
      },
      catch: (e) =>
        new InvalidMetadataError(e instanceof Error ? e.message : "must be valid JSON"),
    });
  }
}
