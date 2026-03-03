import { Effect, Option } from "effect";
import type { SearchParams, SortField, SortOrder } from "../models/document.repository.ts";
import { AppError } from "../types/errors.ts";

// ---------------------------------------------------------------------------
// Search service — pure parsing of raw query-string values into a typed
// SearchParams struct consumed by the document repository.
//
// All coercion and validation happens here so repositories receive clean data.
// ---------------------------------------------------------------------------

const VALID_SORT_FIELDS: SortField[] = ["name", "createdAt", "updatedAt"];
const VALID_SORT_ORDERS: SortOrder[] = ["asc", "desc"];
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const DEFAULT_PAGE = 1;

type RawSearchQuery = {
  readonly name?: string | undefined;
  readonly contentType?: string | undefined;
  /** Comma-separated list of tags */
  readonly tags?: string | undefined;
  /** JSON string of key/value pairs, e.g. '{"author":"alice"}' */
  readonly metadata?: string | undefined;
  readonly page?: string | undefined;
  readonly limit?: string | undefined;
  readonly sortBy?: string | undefined;
  readonly sortOrder?: string | undefined;
  readonly ownerId?: string | undefined;
};

// ---------------------------------------------------------------------------
// parseMetadata — extract + validate the metadata JSON query param.
// ---------------------------------------------------------------------------

function parseMetadata(
  raw: string | undefined,
): Effect.Effect<Option.Option<Record<string, string>>, AppError> {
  if (!raw || raw.trim().length === 0) return Effect.succeed(Option.none());
  return Effect.try({
    try: () => {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw AppError.validation("metadata must be a JSON object of string values");
      }
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== "string") {
          throw AppError.validation(`metadata value for key "${k}" must be a string`);
        }
      }
      return Option.some(parsed as Record<string, string>);
    },
    catch: (e) => {
      if (e !== null && typeof e === "object" && "tag" in e) return e as AppError;
      return AppError.validation("metadata query parameter must be valid JSON");
    },
  });
}

// ---------------------------------------------------------------------------
// parseSearchParams
// Takes the raw query object from the HTTP layer and returns a validated,
// typed SearchParams or an AppError.ValidationError.
// ---------------------------------------------------------------------------

export function parseSearchParams(
  raw: RawSearchQuery,
): Effect.Effect<SearchParams, AppError> {
  return Effect.gen(function* () {
    // --- page ---
    const page = raw.page !== undefined ? parseInt(raw.page, 10) : DEFAULT_PAGE;
    if (!Number.isInteger(page) || page < 1) {
      return yield* Effect.fail(AppError.validation("page must be a positive integer"));
    }

    // --- limit ---
    const limit =
      raw.limit !== undefined ? parseInt(raw.limit, 10) : DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return yield* Effect.fail(
        AppError.validation(`limit must be between 1 and ${MAX_LIMIT}`),
      );
    }

    // --- sortBy ---
    const sortBy: SortField =
      raw.sortBy !== undefined && (VALID_SORT_FIELDS as string[]).includes(raw.sortBy)
        ? (raw.sortBy as SortField)
        : "createdAt";

    // --- sortOrder ---
    const sortOrder: SortOrder =
      raw.sortOrder !== undefined &&
      (VALID_SORT_ORDERS as string[]).includes(raw.sortOrder)
        ? (raw.sortOrder as SortOrder)
        : "desc";

    // --- metadata (JSONB containment filter) ---
    const metadata = yield* parseMetadata(raw.metadata);

    return {
      page,
      limit,
      sortBy,
      sortOrder,
      ownerId: Option.fromNullable(raw.ownerId?.trim() || undefined),
      name: Option.fromNullable(raw.name?.trim() || undefined),
      contentType: Option.fromNullable(raw.contentType?.trim() || undefined),
      tags: Option.fromNullable(
        raw.tags !== undefined && raw.tags.trim().length > 0
          ? raw.tags
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t.length > 0)
          : undefined,
      ),
      metadata,
    } satisfies SearchParams;
  });
}
