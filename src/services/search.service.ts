import type { SearchParams, SortField, SortOrder } from "../models/document.repository.ts";
import { AppError, type AppResult, Result } from "../types/errors.ts";

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
// parseSearchParams
// Takes the raw query object from the HTTP layer and returns a validated,
// typed SearchParams or an AppError.ValidationError.
// ---------------------------------------------------------------------------

export function parseSearchParams(
  raw: RawSearchQuery,
): AppResult<SearchParams> {
  // --- page ---
  const page = raw.page !== undefined ? parseInt(raw.page, 10) : DEFAULT_PAGE;
  if (!Number.isInteger(page) || page < 1) {
    return Result.Err(AppError.validation("page must be a positive integer"));
  }

  // --- limit ---
  const limit =
    raw.limit !== undefined ? parseInt(raw.limit, 10) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return Result.Err(
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

  // --- tags ---
  const tags =
    raw.tags !== undefined && raw.tags.trim().length > 0
      ? raw.tags
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : undefined;

  // --- metadata (JSONB containment filter) ---
  let metadata: Record<string, string> | undefined;
  if (raw.metadata !== undefined && raw.metadata.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw.metadata);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return Result.Err(
          AppError.validation("metadata must be a JSON object of string values"),
        );
      }
      // Ensure all values are strings
      const entries = Object.entries(parsed as Record<string, unknown>);
      for (const [k, v] of entries) {
        if (typeof v !== "string") {
          return Result.Err(
            AppError.validation(`metadata value for key "${k}" must be a string`),
          );
        }
      }
      metadata = parsed as Record<string, string>;
    } catch {
      return Result.Err(
        AppError.validation("metadata query parameter must be valid JSON"),
      );
    }
  }

  const result: SearchParams = {
    page,
    limit,
    sortBy,
    sortOrder,
    ...(raw.name?.trim() ? { name: raw.name.trim() } : {}),
    ...(raw.contentType?.trim() ? { contentType: raw.contentType.trim() } : {}),
    ...(raw.ownerId?.trim() ? { ownerId: raw.ownerId.trim() } : {}),
    ...(tags ? { tags } : {}),
    ...(metadata ? { metadata } : {}),
  };
  return Result.Ok(result);
}
