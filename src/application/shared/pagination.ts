import { Schema as S } from "effect";

export const PaginationQuerySchema = S.Struct({
  page: S.optional(S.Number),
  limit: S.optional(S.Number),
});

export type PaginationQueryEncoded = S.Schema.Encoded<typeof PaginationQuerySchema>;
export type PaginationQuery = S.Schema.Type<typeof PaginationQuerySchema>;
