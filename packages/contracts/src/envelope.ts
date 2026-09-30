import { z } from '@hono/zod-openapi';

/**
 * The list shape of the public API v1 and of the internal API: `metadata` and `result`, pages
 * counted from 0 (ADR-free legacy compatibility, see docs/architecture.md "API architecture").
 */
export const pageMetadataSchema = z.object({
  currentPage: z.int().min(0),
  pageSize: z.int().min(1),
  totalCount: z.int().min(0),
  totalPages: z.int().min(0),
});

export type PageMetadata = z.infer<typeof pageMetadataSchema>;

export function listEnvelope<Item extends z.ZodType>(item: Item) {
  return z.object({ metadata: pageMetadataSchema, result: z.array(item) });
}

export interface ListEnvelope<Item> {
  metadata: PageMetadata;
  result: Item[];
}

export interface PaginationLimits {
  /** Page size when the caller gives none. Default 20. */
  defaultPageSize?: number;
  /** The largest page size accepted. Default 100. */
  maxPageSize?: number;
  /** The highest page number accepted, so an offset cannot overflow. Default 1 000 000. */
  maxPage?: number;
}

const digits = (max: number) =>
  z
    .string()
    .regex(/^\d{1,9}$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().max(max));

/**
 * Query parameters `page` (0-based) and `pageSize`, with limits. Anything that is not a plain
 * whole number, or is out of range, is rejected with a message; there is no silent clamping.
 * Compose it into a route's query schema: `paginationQuery().extend({ q: z.string().max(100).optional() })`.
 */
export function paginationQuery({
  defaultPageSize = 20,
  maxPageSize = 100,
  maxPage = 1_000_000,
}: PaginationLimits = {}) {
  return z.strictObject({
    page: digits(maxPage)
      .default(0 as never)
      .describe('Page number, counted from 0.'),
    pageSize: digits(maxPageSize)
      .refine((value) => value >= 1, 'must be at least 1')
      .default(defaultPageSize as never)
      .describe(`Items per page, 1 to ${maxPageSize}.`),
  });
}

export interface PageQuery {
  page: number;
  pageSize: number;
}

/** The SQL `offset` for a page. */
export function pageOffset({ page, pageSize }: PageQuery): number {
  return page * pageSize;
}

/** Builds the response for one page. `totalCount` is the size of the whole filtered set. */
export function paginate<Item>(
  query: PageQuery,
  totalCount: number,
  result: Item[],
): ListEnvelope<Item> {
  return {
    metadata: {
      currentPage: query.page,
      pageSize: query.pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / query.pageSize),
    },
    result,
  };
}
