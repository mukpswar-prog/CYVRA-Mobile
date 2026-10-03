/**
 * THE PAGER - where "pagination metadata is law" is enforced visually.
 * ====================================================================
 *
 * Three obligations, in priority order:
 *
 * 1. NEVER SILENTLY TRUNCATE. Every number the server sent is rendered:
 *    `total`, `returned`, `hasMore`, `page`, `totalPages`. A table that stops
 *    after 25 rows while claiming nothing about the other 77 is indistinguish-
 *    able from a table that has 25 rows, and an operator who cannot tell the
 *    difference will do their work against the wrong denominator. So the count
 *    is never collapsed into "showing 25" - it is "showing 1–25 of 102".
 *
 * 2. `hasMore` IS TEXT. The next button's disabled state is a *consequence* of
 *    `hasMore`, not a substitute for it: a disabled button reads as "the
 *    server won't let me", which is not the same sentence as "there is nothing
 *    after this". Both are shown, in words.
 *
 * 3. The pageSize control offers EXACTLY 25 / 50 / 100 - the three sizes
 *    `search.ts` serves. Not a number input, not a range, not a "1000" that the
 *    server would answer with a 400. A control offering a value the backend
 *    refuses is a trap, and the refusal sentence would then be the first thing
 *    the operator learns about it.
 */
import { PAGE_SIZES, type Pagination } from "../pagination";

export interface PagerProps {
  pagination: Pagination;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Noun for the sentence, e.g. "licences". Plural, no article. */
  noun: string;
  /** Rendered while the count itself is being fetched. */
  busy?: boolean;
}

export function Pager({ pagination, onPageChange, onPageSizeChange, noun, busy }: PagerProps) {
  const { page, pageSize, offset, returned, total, totalPages, hasMore, nextPage } = pagination;
  const start = total === 0 ? 0 : offset + 1;
  const end = offset + returned;

  /*
   * A page that came back short while `hasMore` still says true means the
   * response contradicts itself. It is not silently corrected here - the
   * numbers are printed as received - but it is surfaced, because the two
   * possible causes (a row-count mismatch or a filter changing mid-flight)
   * both need a human, and neither resolves by paging forward.
   */
  const inconsistent = hasMore && returned < pageSize;

  return (
    <nav className="pager" aria-label="Pagination">
      <div className="pager__stats">
        {busy ? (
          <span className="muted">Counting {noun}…</span>
        ) : (
          <>
            Showing <strong>{start.toLocaleString()}–{end.toLocaleString()}</strong> of{" "}
            <strong>{total.toLocaleString()}</strong> {noun}
            <span className="muted">
              {" "}· page {page} of {Math.max(totalPages, 1)}
              {" "}· returned {returned.toLocaleString()}
              {" "}·{" "}
              <strong data-testid="has-more">{hasMore ? "more pages remain" : "last page"}</strong>
            </span>
          </>
        )}
        {inconsistent ? (
          <div className="notice notice--warn" role="alert">
            The server reports more pages than this one contained ({returned} of {pageSize} rows,
            `hasMore` true). Refresh before acting on these figures - do not assume this page is
            complete.
          </div>
        ) : null}
      </div>

      <div className="pager__controls">
        <label className="row" style={{ gap: 6 }}>
          <span className="muted nowrap">Rows</span>
          <select
            className="select pager__size"
            aria-label="Rows per page"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="btn btn--sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn--sm"
          disabled={!hasMore || nextPage === null}
          onClick={() => onPageChange(nextPage ?? page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
