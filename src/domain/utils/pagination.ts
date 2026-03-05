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
