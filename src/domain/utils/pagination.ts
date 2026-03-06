import { Effect } from "effect";

export interface PaginationParams {
  readonly page: number;
  readonly limit: number;
}

export interface PageInfo {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly pageInfo: PageInfo;
}

export function buildPageInfo(total: number, page: number, limit: number): PageInfo {
  return { total, page, limit, totalPages: Math.ceil(total / limit) };
}

// ---------------------------------------------------------------------------
// parsePagination
// Clamps raw (possibly undefined) page/limit inputs from HTTP query strings
// into safe, integer-valued PaginationParams.
// ---------------------------------------------------------------------------

export const PAGINATION_DEFAULTS = {
  page: 1,
  limit: 20,
  maxLimit: 100,
} as const;

export function parsePagination(raw: {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}): PaginationParams {
  return {
    page: Math.max(1, Math.floor(raw.page ?? PAGINATION_DEFAULTS.page)),
    limit: Math.min(
      PAGINATION_DEFAULTS.maxLimit,
      Math.max(1, Math.floor(raw.limit ?? PAGINATION_DEFAULTS.limit)),
    ),
  };
}

// ---------------------------------------------------------------------------
// withPagination
// HOF that parses pagination from a query, passes the resolved PaginationParams
// to the provided repo operation, and maps the Paginated<T> result to a DTO.
// ---------------------------------------------------------------------------

export function withPagination<
  Q extends { readonly page?: number | undefined; readonly limit?: number | undefined },
  T,
  DTO,
  E,
>(
  query: Q,
  op: (pagination: PaginationParams) => Effect.Effect<Paginated<T>, E>,
  toDTO: (paginated: Paginated<T>) => DTO,
): Effect.Effect<DTO, E> {
  return op(parsePagination(query)).pipe(Effect.map(toDTO));
}
