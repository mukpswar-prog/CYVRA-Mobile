/**
 * §13'S TWENTY COLUMNS, THE FROZEN PAIR, AND THE MASK.
 * ====================================================
 *
 * Three assertions that a screenshot cannot make:
 *
 * 1. The rendered header row equals `COLUMN_HEADERS`, which equals `COLUMNS`.
 *    A column dropped from the spec, renamed, or reordered is a failure here
 *    rather than a difference a reviewer has to spot across 1680px of table.
 *
 *    The list itself is pinned against §13's twelve mandatory fields in §13's
 *    own order, so "User ID and PIN Code quietly disappear" is a failing test
 *    rather than a silently narrower register.
 *
 * 2. `No.` and `Registered Email` are the only frozen columns, and `No.` is
 *    first. A sticky pair only works if they are adjacent and leading, which
 *    is why `User ID` and `PIN Code` are inserted *after* them rather than
 *    at the head of the table.
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
import { MENU_ACTION_IDS, rowActions, type RowActionContext } from "./licences/actions";
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
    createdBy: null,
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
  overrides: { page?: number; pageSize?: number; ctx?: Partial<RowActionContext> } = {},
) {
  const onPick = vi.fn();
  const onOpen = vi.fn();
  const ctx: RowActionContext = {
    role: "LICENCE_ADMIN",
    ...overrides.ctx,
  };
  const utils = render(
    <LicenceTable
      rows={rows}
      onRowOpen={onOpen}
      context={{
        page: overrides.page ?? 1,
        pageSize: overrides.pageSize ?? 25,
        onOpen,
        onPick,
        actionsFor: (row) => rowActions(row, ctx),
      }}
    />,
  );
  return { ...utils, onPick, onOpen };
}

describe("the twenty columns", () => {
  /*
   * §65's recommended order, applied in full on the Chief Engineer's ruling.
   *
   * §65 and §13 do not disagree - walked field by field, §13's twelve mandatory
   * columns appear in §65 in exactly the same relative order, with §65 adding
   * Issued and Activated (both §13 *optional* fields) between Created and
   * Actions. So this is an application of §65, not a choice of one section
   * over the other, and the §13 test below still passes unchanged in intent.
   *
   * "Registered Email" rather than "Customer Email" is §13's own field 2 and
   * the Chief Engineer's explicit instruction; it was carried under the older
   * header until that ruling.
   */
  it("renders §65's recommended column order, in full", () => {
    expect(COLUMN_HEADERS).toEqual([
      "No.",
      "Registered Email",
      "User ID",
      "PIN Code",
      "Licence Plan",
      "Mobile Capacity",
      "Payment Status",
      "Licence Status",
      "Host Binding Status",
      "Licence Key / Serial",
      "Licence ID",
      "Created Date",
      "Issued Date",
      "Activation Date",
      "Customer Name",
      "Company",
      "Customer Type",
      "Expiry / Renewal Date",
      "Issued By",
      "Actions",
    ]);
    expect(COLUMNS).toHaveLength(20);
  });

  /*
   * §65's own list, as a sequence rather than as positions - the same technique
   * the §13 test uses, and for the same reason: §65 permits optional extras and
   * the extras shift everything after them.
   */
  it("keeps §65's fourteen recommended fields in §65's order", () => {
    const recommended = [
      "No.",
      "Registered Email",
      "User ID",
      "PIN Code",
      "Licence Plan",
      "Mobile Capacity",
      "Payment Status",
      "Licence Status",
      "Host Binding Status",
      "Licence Key / Serial",
      "Created Date",
      "Issued Date",
      "Activation Date",
      "Actions",
    ];
    const positions = recommended.map((header) => COLUMN_HEADERS.indexOf(header));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Actions is §65's fixed far-right control zone.
    expect(COLUMN_HEADERS.at(-1)).toBe("Actions");
  });

  /*
   * §13's twelve mandatory fields, walked in §13's own order. The table may
   * carry extra columns - §13 explicitly allows it - but the relative order of
   * the twelve is what "column order ... must strictly match" means, so this
   * asserts the *sequence* rather than the positions (which the extras shift).
   */
  it("keeps §13's twelve mandatory fields in §13's order", () => {
    const mandatory = [
      "No.",
      "Registered Email",
      "User ID",
      "PIN Code",
      "Licence Plan",
      "Mobile Capacity",
      "Payment Status",
      "Licence Status",
      "Host Binding Status",
      "Licence Key / Serial",
      "Created Date",
      "Actions",
    ];
    const positions = mandatory.map((header) => COLUMN_HEADERS.indexOf(header));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  /*
   * §15 / RULE 2: the User ID *is* the registered email. Rendering anything
   * else here would be inventing an identifier the freeze says does not exist,
   * and dropping the column because it "duplicates" the one beside it would
   * drop a field §13 marks mandatory. Asserted so the duplication reads as
   * deliberate rather than as a copy-paste defect.
   */
  it("renders User ID as the registered email, because §15 says they are equal", () => {
    renderTable([listItem()]);
    const headers = screen.getAllByRole("columnheader");
    const userIndex = headers.findIndex((header) => header.textContent === "User ID");
    const emailIndex = headers.findIndex((header) => header.textContent === "Registered Email");
    expect(userIndex).toBeGreaterThan(0);
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[userIndex].textContent).toBe(cells[emailIndex].textContent);
    expect(cells[userIndex].textContent).toBe("customer@example.com");
  });

  /*
   * §16 PIN CODE: the postal code, under §16's recommended label, and absent
   * rows an em dash rather than a blank - a blank cell reads as "not loaded".
   */
  it("renders the postal PIN Code, and an em dash when there is none", () => {
    renderTable([listItem({ pincode: "400001" }), listItem({ pincode: null })]);
    const headers = screen.getAllByRole("columnheader");
    const pinIndex = headers.findIndex((header) => header.textContent === "PIN Code");
    expect(pinIndex).toBeGreaterThan(0);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getAllByRole("cell")[pinIndex].textContent).toBe("400001");
    expect(within(rows[2]).getAllByRole("cell")[pinIndex].textContent).toBe("—");
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
    // `Licence ID` sits at index 10, beside `Licence Key / Serial`: §13 field 10
    // is "Licence Serial / ID", and §65 places the serial after Host Binding.
    // Index 1 is `Registered Email`, immediately after `No.`.
    expect(cells[10].textContent).toContain("00000000-0000-4000-8000-000000000001");
    expect(cells[1].textContent).toContain("customer@example.com");
  });
});

describe("the frozen pair", () => {
  it("freezes No. first and Registered Email second, and nothing else", () => {
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
      /Column No\. and Registered Email stay visible/,
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
  it("renders §28's nine entries, each with its own reason when disabled", async () => {
    const user = userEvent.setup();
    renderTable([listItem({ status: "DRAFT", paymentStatus: "PENDING", devicesBound: 0 })]);
    await user.click(screen.getByRole("button", { name: "Actions for customer@example.com" }));

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(MENU_ACTION_IDS.length);
    expect(items).toHaveLength(9);
    const disabled = items.filter((item) => item.hasAttribute("disabled"));
    expect(disabled.length).toBeGreaterThan(0);
    for (const item of disabled) {
      const why = item.querySelector(".rowmenu__why");
      expect(why?.textContent ?? "").not.toBe("");
    }
  });

  it("keeps Issue and Revoke out of the menu - they are already on the row", async () => {
    const user = userEvent.setup();
    renderTable([listItem({ status: "READY_TO_GENERATE", paymentStatus: "PAID" })]);
    await user.click(screen.getByRole("button", { name: "Actions for customer@example.com" }));

    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
    expect(labels.join(" | ")).not.toMatch(/Issue Licence/);
    expect(labels.join(" | ")).not.toMatch(/^Revoke/);
    // ...and they are present, visible, without opening anything.
    expect(screen.getByRole("button", { name: "Issue Licence" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revoke licence for/ })).toBeInTheDocument();
  });
});

/*
 * §66 is titled "EXACT ROW ACTION RULE", so these assert the drawing itself
 * rather than a vibe. The closing sentence of that section - "The UI should not
 * show an impossible operation as enabled" - is why Revoke stays *visible* on a
 * ready row (§25 asks for the control to remain obvious) while being disabled:
 * revoking is not a legal edge from that state, and the reason is in its title.
 */
describe("§66's visible row action zone", () => {
  it("shows [ ISSUE LICENCE ] green and [ REVOKE ] red on a paid, issuable row", () => {
    renderTable([listItem({ status: "READY_TO_GENERATE", paymentStatus: "PAID" })]);

    const issue = screen.getByRole("button", { name: "Issue Licence" });
    expect(issue).not.toBeDisabled();
    expect(issue.className).toContain("btn--ready");

    const revoke = screen.getByRole("button", { name: /Revoke licence for/ });
    expect(revoke.className).toContain("btn--danger");
    expect(revoke).toBeDisabled();
    expect(revoke.getAttribute("title") ?? "").not.toBe("");
  });

  it("shows [ ISSUE LICENCE ] but grey/disabled while payment is pending", () => {
    renderTable([listItem({ status: "PAYMENT_PENDING", paymentStatus: "PENDING" })]);

    const issue = screen.getByRole("button", { name: "Issue Licence" });
    expect(issue).toBeDisabled();
    expect(issue.className).not.toContain("btn--ready");
    expect(issue.getAttribute("title") ?? "").toMatch(/payment/i);

    const revoke = screen.getByRole("button", { name: /Revoke licence for/ });
    expect(revoke.className).toContain("btn--danger");
  });

  it("swaps to [ VIEW ] once the licence has been issued", () => {
    renderTable([listItem({ status: "ACTIVE", paymentStatus: "PAID" })]);

    expect(screen.queryByRole("button", { name: "Issue Licence" })).toBeNull();
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revoke licence for/ })).toBeInTheDocument();
  });

  it("leaves Revoke visible-but-disabled where §28 says it cannot run", () => {
    renderTable([listItem({ status: "DRAFT", paymentStatus: "PENDING" })]);
    const revoke = screen.getByRole("button", { name: /Revoke licence for/ });
    expect(revoke).toBeDisabled();
    expect(revoke.className).toContain("btn--danger");
    expect(revoke.getAttribute("title") ?? "").not.toBe("");
  });

  it("offers exactly two controls, with no second flavour of Issue", () => {
    renderTable([listItem({ status: "PAYMENT_PENDING", paymentStatus: "PENDING" })]);
    // The split button's caret was cut before commit (WS-H1 sign-off item 2).
    expect(screen.queryByRole("button", { name: /More issue options/i })).toBeNull();
    expect(screen.queryByRole("menu", { name: "Issue options" })).toBeNull();
    const zone = screen.getAllByRole("button").filter((b) => /Issue Licence|View/.test(b.textContent ?? ""));
    expect(zone).toHaveLength(1);
  });
});

/** Text of one column across every body row (0 = No., 1 = Customer, ...). */
function columnTexts(columnIndex: number): string[] {
  const [, ...rows] = screen.getAllByRole("row");
  return rows.map((row) => within(row).getAllByRole("cell")[columnIndex].textContent ?? "");
}
