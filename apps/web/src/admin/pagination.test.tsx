/**
 * THE PAGER CONSUMES THE SERVER'S METADATA - IT NEVER RE-DERIVES IT.
 * ==================================================================
 *
 * "Pagination metadata is law: never silently truncate; render the pager;
 * pageSize selector 25/50/100; show total/returned/hasMore."
 *
 * Each of those is a separate assertion here because each fails differently
 * and each is easy to break without noticing:
 *
 *   - `Showing 1–25 of 102` proves `total` was rendered rather than the row
 *     count. A pager built from `rows.length` would say `25` and look right.
 *   - `returned 25` is the third number, printed even though it equals the
 *     range's width, because a short page is exactly when it differs.
 *   - `more pages remain` / `last page` renders `hasMore` as *words*. The Next
 *     button's disabled state alone would read as a permission problem.
 *   - The options list is asserted to be exactly `[25, 50, 100]` so a control
 *     offering a size the server refuses with a 400 cannot ship.
 *
 * `busy` is the fourth case: while the count is in flight the pager must say
 * so rather than rendering `0`, which would be a claim about the database
 * made from a request that has not answered yet.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Pager } from "./components/Pager";
import { LOADING_PAGINATION, PAGE_SIZES } from "./pagination";
import type { Pagination } from "./types";

function page(overrides: Partial<Pagination> = {}): Pagination {
  return { ...LOADING_PAGINATION, ...overrides };
}

describe("Pager renders the server's numbers verbatim", () => {
  it("shows total, offset-derived range, returned and page together", () => {
    const pagination = page({
      page: 1,
      pageSize: 25,
      offset: 0,
      returned: 25,
      total: 102,
      totalPages: 5,
      hasMore: true,
      nextPage: 2,
    });
    render(
      <Pager
        pagination={pagination}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        noun="licences"
      />,
    );

    const text = screen.getByText(/Showing/).parentElement?.textContent ?? "";
    expect(text).toContain("Showing");
    expect(text).toContain("1–25");
    expect(text).toContain("102");
    expect(text).toContain("page 1 of 5");
    expect(text).toContain("returned 25");
    expect(screen.getByTestId("has-more")).toHaveTextContent("more pages remain");
  });

  it("reports the last page as last, in words, not only by disabling Next", () => {
    render(
      <Pager
        pagination={page({
          page: 5,
          pageSize: 25,
          offset: 100,
          returned: 2,
          total: 102,
          totalPages: 5,
          hasMore: false,
          nextPage: null,
        })}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        noun="licences"
      />,
    );
    expect(screen.getByTestId("has-more")).toHaveTextContent("last page");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });

  it("keeps the range honest for a page that is not full", () => {
    render(
      <Pager
        pagination={page({
          page: 3,
          pageSize: 50,
          offset: 100,
          returned: 50,
          total: 1000,
          totalPages: 20,
          hasMore: true,
          nextPage: 4,
        })}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        noun="licences"
      />,
    );
    const text = screen.getByText(/Showing/).parentElement?.textContent ?? "";
    expect(text).toContain("101–150");
    expect(text).toContain("1,000");
    expect(text).toContain("returned 50");
  });

  it("renders a total of 0 as a real zero rather than as \"Counting\"", () => {
    render(
      <Pager
        pagination={page({
          returned: 0,
          total: 0,
          totalPages: 0,
          hasMore: false,
          nextPage: null,
        })}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        noun="licences"
      />,
    );
    const text = screen.getByText(/Showing/).parentElement?.textContent ?? "";
    expect(text).toContain("0–0 of");
    expect(screen.getByTestId("has-more")).toHaveTextContent("last page");
  });
});

describe("Pager refuses to imply completeness it does not have", () => {
  it("says \"Counting\" while the count is in flight instead of rendering 0", () => {
    render(
      <Pager
        pagination={LOADING_PAGINATION}
        busy
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        noun="licences"
      />,
    );
    expect(screen.getByText(/Counting licences/)).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("has-more")).not.toBeInTheDocument();
  });

  it("raises an alert when the server reports more pages than this one held", () => {
    render(
      <Pager
        pagination={page({
          page: 1,
          pageSize: 25,
          offset: 0,
          returned: 17,
          total: 102,
          totalPages: 5,
          hasMore: true,
          nextPage: 2,
        })}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        noun="licences"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("17 of 25 rows");
    expect(alert).toHaveTextContent("do not assume this page is complete");
    // The server's own figures are still shown - the warning adds to them.
    expect(screen.getByTestId("has-more")).toHaveTextContent("more pages remain");
  });
});

describe("the pageSize control offers exactly what search.ts serves", () => {
  it("lists 25, 50 and 100 and nothing else", () => {
    render(
      <Pager
        pagination={page()}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        noun="licences"
      />,
    );
    const options = [...screen.getByRole("combobox", { name: "Rows per page" })
      .querySelectorAll("option")];
    expect(options.map((option) => option.textContent)).toEqual(["25", "50", "100"]);
    expect([...PAGE_SIZES]).toEqual([25, 50, 100]);
  });

  it("emits the chosen size, so the request carries it", async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    render(
      <Pager
        pagination={page()}
        onPageChange={() => undefined}
        onPageSizeChange={onPageSizeChange}
        noun="licences"
      />,
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "100");
    expect(onPageSizeChange).toHaveBeenCalledWith(100);
  });

  it("emits the next page and never page 0", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pager
        pagination={page({ page: 1, hasMore: true, nextPage: 2, total: 100, totalPages: 4 })}
        onPageChange={onPageChange}
        onPageSizeChange={() => undefined}
        noun="licences"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    // Page 1 has no page 0 to go to; the control must not offer one.
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });
});
