/**
 * §5'S EIGHTEEN COLUMNS, THE FROZEN PAIR, AND THE MASK.
 * =====================================================
 *
 * Three assertions that a screenshot cannot make:
 *
 * 1. The rendered header row equals `COLUMN_HEADERS`, which equals `COLUMNS`.
 *    A column dropped from the spec, renamed, or reordered is a failure here
 *    rather than a difference a reviewer has to spot across 1680px of table.
 *
 * 2. `No.` and `Customer Email` are the only frozen columns, and `No.` is
 *    first. §5's footer asks for a sticky No. + Customer pair; that only works
 *    if they are adjacent and leading, which is the one deviation this file
 *    records (positions 2 and 3 swapped - see `LicenceTable.tsx`).
 *
 * 3. The row number is derived from the *page*, not from the array index.
 *    Page 3 at 25 rows must start at 51. Rendering `1..25` on every page would
 *    look identical on page 1 and be wrong on every other page - which is
 *    precisely the kind of bug that survives review because the reviewer
 *    always lands on page 1.
 *
 * Plus the mask: the list projection never carries a full key, and this file
 * asserts the cell renders what it was given and nothing more.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ROW_ACTION_IDS, rowActions } from "./licences/actions";
import { COLUMN_HEADERS, COLUMNS, LicenceTable } from "./licences/LicenceTable";
import type { LicenceListItem } from "./types";

const FULL_KEY = "CYVRA01102026SA3F1-1-5";
const MASKED_KEY = "CYVRA*************-1-5";

function listItem(overrides: Partial<LicenceListItem> = {}): LicenceListItem {
  return {
    serialId: "00000000-0000-4000-8000-000000000001",
    status: "ISSUED",
    customerKind: "SINGLE",
    deviceMax: 5,
    planCode: "CAP-5",
    hostBindingStatus: "BOUND",
    slabLabel: "25 Mobile Devices",
    brandScope: "ALL",
    customerEmail: "customer@example.com",
    customerFullName: "A Customer",
    companyName: null,
    addressLine1: null,
    addressLine2: null,
    pincode: null,
    state: null,
    userId: null,
    paymentNoted: "",
    paymentStatus: "PAID",
    firstActivatedAt: null,
    validityStartsAt: null,
    validityEndsAt: null,
    devicesBound: 0,
    issuedBy: null,
    issuedAt: null,
    revokedAt: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    emailedAt: null,
    emailMessageId: null,
    emailError: null,
    licenceKey: MASKED_KEY,
    publicNumberMasked: MASKED_KEY,
    serialFp: "deadbeef",
    ...overrides,
  };
}

function renderTable(
  rows: LicenceListItem[],
  overrides: { page?: number; pageSize?: number } = {},
) {
  const onPick = vi.fn();
  const onOpen = vi.fn();
  const utils = render(
    <LicenceTable
      rows={rows}
      onRowOpen={onOpen}
      context={{
        page: overrides.page ?? 1,
        pageSize: overrides.pageSize ?? 25,
        onOpen,
        onPick,
        actionsFor: (row) => rowActions(row, { role: "LICENCE_ADMIN", isSuperAdmin: false }),
      }}
    />,
  );
  return { ...utils, onPick, onOpen };
}

describe("the eighteen columns", () => {
  it("renders exactly §5's header set, in order", () => {
    expect(COLUMN_HEADERS).toEqual([
      "No.",
      "Customer Email",
      "Licence ID",
      "Customer Name",
      "Company",
      "Customer Type",
      "Licence Plan",
      "Mobile Capacity",
      "Payment Status",
      "Licence Status",
      "Host Binding Status",
      "Licence Key / Serial",
      "Created Date",
      "Issued Date",
      "Activation Date",
      "Expiry / Renewal Date",
      "Issued By",
      "Actions",
    ]);
    expect(COLUMNS).toHaveLength(18);
  });

  it("renders one header cell per column and no extras", () => {
    renderTable([listItem()]);
    const headerCells = screen.getAllByRole("columnheader");
    expect(headerCells).toHaveLength(COLUMNS.length);
    expect(headerCells.map((cell) => cell.textContent)).toEqual([...COLUMN_HEADERS]);
  });

  it("renders one body cell per column, in the same order", () => {
    renderTable([listItem()]);
    const rows = screen.getAllByRole("row");
    const cells = within(rows[1]).getAllByRole("cell");
    expect(cells).toHaveLength(COLUMNS.length);
    expect(cells[2].textContent).toContain("00000000-0000-4000-8000-000000000001");
    expect(cells[1].textContent).toContain("customer@example.com");
  });
});

describe("the frozen pair", () => {
  it("freezes No. first and Customer Email second, and nothing else", () => {
    renderTable([listItem()]);
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveClass("sticky-1");
    expect(headers[1]).toHaveClass("sticky-2");
    const frozen = headers.filter((header) => /sticky-[12]/.test(header.className));
    expect(frozen).toHaveLength(2);
  });

  it("freezes the matching body cells too, so scrolling does not split them", () => {
    renderTable([listItem()]);
    const [, ...rows] = screen.getAllByRole("row");
    const cells = within(rows[0]).getAllByRole("cell");
    expect(cells[0]).toHaveClass("sticky-1");
    expect(cells[1]).toHaveClass("sticky-2");
    expect(cells.filter((cell) => /sticky-[12]/.test(cell.className))).toHaveLength(2);
  });

  it("states the frozen columns in the accessible caption", () => {
    renderTable([listItem()]);
    expect(screen.getByRole("table")).toHaveAccessibleName(
      /Column No\. and Customer Email stay visible/,
    );
  });
});

describe("row numbers follow the page, not the array", () => {
  it("starts at 1 on page 1", () => {
    renderTable([listItem(), listItem(), listItem()]);
    expect(columnTexts(0)).toEqual(["1", "2", "3"]);
  });

  it("continues from the offset on a later page", () => {
    renderTable(
      [listItem(), listItem(), listItem()],
      { page: 3, pageSize: 25 },
    );
    expect(columnTexts(0)).toEqual(["51", "52", "53"]);
  });

  it("follows a non-default page size", () => {
    renderTable([listItem()], { page: 4, pageSize: 100 });
    expect(columnTexts(0)).toEqual(["301"]);
  });
});

describe("the key column", () => {
  it("renders the masked value the server sent and nothing else", () => {
    renderTable([listItem()]);
    expect(screen.getByText(MASKED_KEY)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(FULL_KEY);
  });

  it("says the record holds the full key rather than showing it", () => {
    renderTable([listItem()]);
    const cell = screen.getByText(MASKED_KEY);
    expect(cell).toHaveAttribute("title", "Masked. Open the record for the full key.");
  });

  it("shows a sentence rather than an empty cell when no key exists", () => {
    renderTable([listItem({ licenceKey: null, publicNumberMasked: null, serialFp: null })]);
    expect(screen.getByText("No key yet")).toBeInTheDocument();
  });
});

describe("opening a row", () => {
  it("opens the record when the customer email is clicked", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderTable([listItem()]);
    await user.click(screen.getByRole("button", { name: "customer@example.com" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("the row menu in a table", () => {
  it("renders all twelve entries, each with its own reason when disabled", async () => {
    const user = userEvent.setup();
    renderTable([listItem({ status: "DRAFT", paymentStatus: "PENDING", devicesBound: 0 })]);
    await user.click(screen.getByRole("button", { name: "Actions for customer@example.com" }));

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(ROW_ACTION_IDS.length);
    const disabled = items.filter((item) => item.hasAttribute("disabled"));
    expect(disabled.length).toBeGreaterThan(0);
    for (const item of disabled) {
      const why = item.querySelector(".rowmenu__why");
      expect(why?.textContent ?? "").not.toBe("");
    }
  });
});

/** Text of one column across every body row (0 = No., 1 = Customer, ...). */
function columnTexts(columnIndex: number): string[] {
  const [, ...rows] = screen.getAllByRole("row");
  return rows.map((row) => within(row).getAllByRole("cell")[columnIndex].textContent ?? "");
}
