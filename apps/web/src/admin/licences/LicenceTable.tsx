/**
 * THE LICENCE REGISTRY TABLE - §13's twelve mandatory fields, data-driven.
 * ========================================================================
 *
 * The columns are a `readonly` array rather than twenty hand-written
 * `<th>`/`<td>` pairs, so the header row and the body cells cannot drift: a
 * column exists in exactly one place, and `licenceTable.test.tsx` asserts the
 * rendered header equals `COLUMNS` - which means a renamed header, a dropped
 * cell or a reordered column is one assertion away from a failure rather than
 * something a reviewer has to notice by eye across 1680px of table.
 *
 * §13 NAMES TWELVE FIELDS AND ALLOWS MORE
 * ---------------------------------------
 * §13 is titled EXACT MAIN TABLE PRINCIPLE. It mandates, in order:
 *
 *   No. | Registered Email | User ID | PIN Code | Licence Type |
 *   Mobile Device Capacity | Payment Status | Licence Status |
 *   Host Binding Status | Licence Serial / ID | Created Date | Actions
 *
 * and then says: "The actual production table can contain additional columns".
 * So the rule is an ORDER over the mandatory twelve, not a demand that they be
 * contiguous - §13's own worked example cannot be read as demanding adjacency,
 * because it draws eight columns while mandating twelve, i.e. it is schematic.
 *
 * `COLUMNS` below keeps the relative order of all twelve exactly as §13 lists
 * them, and seats §13's permitted extras (Licence ID, Customer Name, Company,
 * Customer Type, Issued/Activation/Expiry, Issued By) between them. §65's
 * "recommended final order" would additionally push those extras to the end,
 * just before Actions; that is recorded as a deviation rather than applied
 * silently, because §65 says *recommended* and §13 is what the brief cites.
 *
 * §15 AND §16 SAY WHAT THE TWO NEW COLUMNS MEAN
 * --------------------------------------------
 * `User ID` is not a second identifier invented here: §15 says it "equals the
 * registered email ID for the current CYVRA Mobile customer model", and RULE 2
 * repeats it - "Customer User ID = registered email ID." It therefore renders
 * the registered email, and `licenceTable.test.tsx` asserts that equality so
 * the duplication can never be mistaken for a copy-paste defect.
 *
 * `PIN Code` is the postal code: §16 is titled PIN CODE and opens "The
 * customer PIN code / postal code is a required customer-information field",
 * with the recommended label `PIN Code`. It is not the licence key - §16 says
 * so explicitly - and it is not masked, because §16 masks only "if the PIN is
 * sensitive in the actual customer model", and a six-digit postal code is the
 * address field the customer typed on the registration form.
 *
 * §58 DATE AND TIME
 * -----------------
 * Every date cell renders through `format/datetime`, which is fixed to
 * Asia/Kolkata. This file used to carry its own `timeZone: "UTC"` formatters;
 * see that module for why that was a violation rather than a style choice.
 *
 * Only `No.` and `Registered Email` are frozen (296px). Freezing the whole
 * customer *block* - email, name, company, type - would cost ~700px of
 * horizontal room, which on a 1680px table leaves too little scrolling surface
 * for the sticky columns to be doing anything useful.
 */
import type { ReactNode } from "react";
import { Badge } from "../components/kit";
import {
  customerKindTone,
  expiryTone,
  hostBindingTone,
  licenceStatusTone,
  paymentTone,
} from "../components/tone";
import { RowMenu } from "../components/RowMenu";
import { formatDate } from "../format/datetime";
import type { RowActionDecision, RowActionId } from "./actions";
import { RowZone } from "./RowZone";
import type { LicenceListItem } from "../types";

export interface CellContext {
  /** 0-based position on the current page. */
  readonly index: number;
  readonly page: number;
  readonly pageSize: number;
  /** Decisions for this row, or `null` when the menu is not rendered. */
  readonly actions: readonly RowActionDecision[] | null;
  readonly onOpen: (row: LicenceListItem) => void;
  readonly onPick: (row: LicenceListItem, id: RowActionId) => void;
}

export interface ColumnDef {
  readonly id: string;
  readonly header: string;
  /** Which frozen column this belongs to, if any. */
  readonly sticky?: 1 | 2;
  readonly className?: string;
  render(row: LicenceListItem, ctx: CellContext): ReactNode;
}

/* ------------------------------------------------------------------ format */

/*
 * `formatDate` and `formatDateTime` used to live here, hard-coded to
 * `timeZone: "UTC"`. They moved to `format/datetime` - the one IST formatter
 * §58 asks for - and are imported rather than re-exported, so that the registry
 * table cannot drift back to its own copy while the drawer, the audit trail and
 * the staff page render the same instant as a different calendar date.
 */

/* ----------------------------------------------------------------- columns */

/**
 * An absent cell value as an em dash, so a blank can never be mistaken for a
 * populated one. Exported because `LicenceDrawer`'s "Created by" / "Issued by"
 * rows must fall back exactly the way this column does.
 *
 * The glyph is left exactly as it was: this helper feeds every `COLUMNS` cell,
 * so its output is part of how the registry table looks, and §13/§65 keep that
 * table as it is.
 */
export function dash(value: string | null | undefined): ReactNode {
  return value && value !== "" ? value : <span className="muted">—</span>;
}

/**
 * THE REGISTER'S COLUMN ORDER - §65, with §13's twelve as its backbone.
 * =====================================================================
 *
 * §65 "MAIN TABLE — PROFESSIONAL COLUMN ORDER" gives the recommended final
 * order; this array follows it exactly:
 *
 *     No. | Registered Email | User ID | PIN Code | Licence Plan |
 *     Mobile Capacity | Payment Status | Licence Status |
 *     Host Binding Status | Licence Serial | Created | Issued |
 *     Activated | Actions
 *
 * §65 and §13 do not disagree, which is why this is an application of §65 and
 * not a choice between them: walk §13's twelve mandatory fields and they appear
 * in §65 in precisely that relative order. §65's contribution is to promote two
 * of §13's *optional* fields (Issued Date, Activation Date) into the core
 * sequence at positions 12-13, and to place §13's optional extras after them.
 * Verified field by field before this reorder was made.
 *
 * TWO COLUMNS §65 DOES NOT NAME, AND WHY THEY REMAIN
 * -------------------------------------------------
 *   - `Licence ID`: §13 field 10 is "Licence Serial / ID", so the id is half
 *     of a mandatory field rather than an extra. It sits against the serial.
 *   - `Issued By`: §13 lists it among the permitted optional columns; §65 is
 *     silent rather than prohibitive about it.
 *
 * Neither is deleted, because §65's optional list ("Customer Name, Company,
 * Customer Type, Expiry") reads as what *may* be added, and §13 explicitly
 * allows both. Actions stays far right - §65 fixes it as the operational
 * control zone.
 */
export const COLUMNS: readonly ColumnDef[] = Object.freeze([
  {
    id: "no",
    header: "No.",
    sticky: 1,
    className: "num sticky-1",
    render: (_row, ctx) => (ctx.page - 1) * ctx.pageSize + ctx.index + 1,
  },
  {
    id: "customerEmail",
    header: "Registered Email",
    sticky: 2,
    className: "sticky-2",
    render: (row, ctx) => (
      <button
        type="button"
        className="cell-open cell-customer"
        title={`Open ${row.customerEmail}`}
        onClick={() => ctx.onOpen(row)}
      >
        {row.customerEmail}
      </button>
    ),
  },
  {
    id: "userId",
    header: "User ID",
    /*
     * §15: "User ID: equals the registered email ID for the current CYVRA
     * Mobile customer model ... is not separately invented by the Admin."
     * RULE 2 says the same thing from the other side: "Customer User ID =
     * registered email ID." So this cell is the registered email on purpose,
     * and rendering `mobileSerials.user_id` - an internal uuid foreign key -
     * would answer a question §15 never asked.
     *
     * Deliberate duplication of the previous column, pinned by an assertion in
     * `licenceTable.test.tsx` so a future reader does not "fix" it.
     */
    render: (row) => <span className="mono">{row.customerEmail}</span>,
  },
  {
    id: "pinCode",
    header: "PIN Code",
    /*
     * §16 PIN CODE: "The customer PIN code / postal code is a required
     * customer-information field where applicable. Recommended table label:
     * PIN Code." - hence the header, and hence not "Postal Code".
     *
     * Not masked: §16 masks only "if the PIN is sensitive in the actual
     * customer model", and this is the six-digit address field the customer
     * typed at registration (`registration.ts` requires exactly six digits).
     * §16's other warning - "The PIN must not be confused with the licence
     * key" - is why the cell never touches `licenceKey`.
     */
    render: (row) => dash(row.pincode),
  },
  {
    id: "plan",
    header: "Licence Plan",
    render: (row) => (
      <span>
        {row.planCode}
        <span className="cell-sub">{row.slabLabel}</span>
      </span>
    ),
  },
  {
    id: "deviceMax",
    header: "Mobile Capacity",
    className: "num",
    render: (row) => `${row.deviceMax}`,
  },
  {
    id: "paymentStatus",
    header: "Payment Status",
    render: (row) => <Badge view={paymentTone(row.paymentStatus)} />,
  },
  {
    id: "status",
    header: "Licence Status",
    render: (row) => <Badge view={licenceStatusTone(row.status)} />,
  },
  {
    id: "hostBindingStatus",
    header: "Host Binding Status",
    render: (row) => <Badge view={hostBindingTone(row.hostBindingStatus)} />,
  },
  {
    id: "licenceKey",
    header: "Licence Key / Serial",
    render: (row) =>
      row.licenceKey ? (
        <span className="cell-key" title="Masked. Open the record for the full key.">
          {row.licenceKey}
        </span>
      ) : (
        <span className="muted">No key yet</span>
      ),
  },
  /*
   * §13 field 10 is "Licence Serial / ID" - one concept, two cells. §65 lists
   * only "Licence Serial", so the immutable row id sits beside the serial it
   * identifies rather than at the head of the table where it used to live: the
   * pair reads as one field and §65's own sequence stays intact around it.
   */
  { id: "serialId", header: "Licence ID", render: (row) => <span className="mono">{row.serialId}</span> },
  { id: "createdAt", header: "Created Date", render: (row) => formatDate(row.createdAt) },
  { id: "issuedAt", header: "Issued Date", render: (row) => formatDate(row.issuedAt) },
  {
    id: "firstActivatedAt",
    header: "Activation Date",
    render: (row) => formatDate(row.firstActivatedAt),
  },
  /*
   * §65's optional block - Customer Name, Company, Customer Type, Expiry - in
   * §65's listed order, and placed before Actions because §66 fixes Actions as
   * the far-right control zone. §13 permits all three as optional extras, and
   * §65 says they move to the drawer if the table gets too wide: they are kept
   * here rather than dropped, because "can move to the drawer" is a layout
   * permission, not an instruction to delete data from the register.
   */
  {
    id: "customerFullName",
    header: "Customer Name",
    render: (row) => dash(row.customerFullName),
  },
  {
    id: "companyName",
    header: "Company",
    render: (row) => dash(row.companyName),
  },
  {
    id: "customerKind",
    header: "Customer Type",
    render: (row) => <Badge view={customerKindTone(row.customerKind)} />,
  },
  {
    id: "validityEndsAt",
    header: "Expiry / Renewal Date",
    render: (row) => {
      const tone = expiryTone(row.validityEndsAt);
      return (
        <span>
          {formatDate(row.validityEndsAt)}
          {tone ? <span className="cell-sub">{tone.text}</span> : null}
        </span>
      );
    },
  },
  { id: "issuedBy", header: "Issued By", render: (row) => dash(row.issuedBy) },
  {
    id: "actions",
    header: "Actions",
    render: (row, ctx) =>
      ctx.actions === null ? (
        <span className="muted">—</span>
      ) : (
        /*
         * §66's visible pair first, then §28's three-dot menu. Both read the
         * same decision list, so the row cannot be issuable in one place and
         * refused in the other.
         */
        <div className="rowactions">
          <RowZone
            status={row.status}
            actions={ctx.actions}
            rowLabel={row.customerEmail}
            onPick={(id) => ctx.onPick(row, id)}
          />
          <RowMenu
            actions={ctx.actions}
            rowLabel={row.customerEmail}
            onPick={(id) => ctx.onPick(row, id)}
          />
        </div>
      ),
  },
] as ColumnDef[]);

/** Just the headers, in order - what `LicenceTable.test.tsx` compares against. */
export const COLUMN_HEADERS: readonly string[] = COLUMNS.map((column) => column.header);

/* -------------------------------------------------------------------- view */

export function LicenceTable({
  rows,
  context,
  onRowOpen,
}: {
  rows: readonly LicenceListItem[];
  context: Omit<CellContext, "index" | "actions"> & {
    /** Supplies this row's decisions; `null` skips the menu. */
    actionsFor: (row: LicenceListItem, index: number) => readonly RowActionDecision[] | null;
  };
  onRowOpen: (row: LicenceListItem) => void;
}) {
  // Split once, so the spread below carries exactly `CellContext`'s fields -
  // `actionsFor` is a control this component consumes, not a cell's input, and
  // leaving it in the literal would trip the excess-property check.
  const { actionsFor, ...base } = context;

  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">
          Licence registry. Column {COLUMNS[0].header} and {COLUMNS[1].header} stay visible while
          the rest scroll sideways.
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={column.sticky === 1 ? "sticky-1" : column.sticky === 2 ? "sticky-2" : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.serialId} onDoubleClick={() => onRowOpen(row)}>
              {COLUMNS.map((column) => (
                <td key={column.id} className={column.className}>
                  {column.render(row, {
                    ...base,
                    index,
                    actions: actionsFor(row, index),
                  })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
