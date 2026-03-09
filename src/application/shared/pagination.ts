import { Effect as E, Schema as S } from "effect";
import type { Paginated, PaginationParams } from "@domain/utils/pagination.ts";

export const PaginationQuerySchema = S.Struct({
  page: S.optional(S.Number),
  limit: S.optional(S.Number),
});

export type PaginationQueryEncoded = S.Schema.Encoded<typeof PaginationQuerySchema>;
export type PaginationQuery = S.Schema.Type<typeof PaginationQuerySchema>;

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

export function withPagination<
  Q extends { readonly page?: number | undefined; readonly limit?: number | undefined },
  T,
  DTO,
  Err,
>(
  query: Q,
  op: (pagination: PaginationParams) => E.Effect<Paginated<T>, Err>,
  toDTO: (paginated: Paginated<T>) => DTO,
): E.Effect<DTO, Err> {
  return op(parsePagination(query)).pipe(E.map(toDTO));
}
