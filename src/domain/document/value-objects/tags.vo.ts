/**
 * Tags value object.
 *
 * Invariants:
 *  - A tag is a non-empty, trimmed string.
 *  - Tags are parsed from raw comma-separated input; empty segments are discarded.
 *  - Internal order is preserved.
 *  - The value object is immutable.
 */
export class Tags {
  private constructor(readonly value: readonly string[]) {
    Object.freeze(this);
  }

  static empty(): Tags {
    return new Tags([]);
  }

  /**
   * Wrap an already-validated array (e.g. from persistence).
   */
  static from(arr: readonly string[]): Tags {
    return new Tags([...arr]);
  }

  /**
   * Parse a raw comma-separated string into a Tags instance.
   * Always succeeds — absent or empty input yields Tags.empty().
   */
  static parse(raw: string | null | undefined): Tags {
    if (!raw || raw.trim().length === 0) return Tags.empty();
    return new Tags(
      raw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    );
  }
}
