/**
 * Pagination constants shared by every paged view.
 *
 * `PAGE_SIZES` is a mirror of `services/api/src/admin/search.ts`, and it is a
 * mirror rather than a server-returned option list for one reason: the control
 * has to render *before* the first response arrives. The three values are
 * frozen there and here; `search.test.ts` on the server side pins them to
 * `[25, 50, 100]`, and `Pager.test.tsx` pins this copy to the same, so a
 * divergence is a test failure rather than a 400 in production.
 */
import type { Pagination } from "./types";

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value);
}

export type { Pagination };

/**
 * The shape a view holds before its first response lands.
 *
 * Deliberately *not* all zeros: `total: 0` would render as "no licences exist"
 * during the first request, and an operator who reads that while the page is
 * still loading has been told something false about the database. `null`
 * fields keep the pager in its explicit "Counting …" state instead.
 */
export const LOADING_PAGINATION: Pagination = {
  page: 1,
  pageSize: 25,
  offset: 0,
  returned: 0,
  total: 0,
  totalPages: 1,
  hasMore: false,
  nextPage: null,
};
