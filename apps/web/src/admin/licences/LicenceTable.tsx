/**
 * THE LICENCE REGISTRY TABLE - §5's eighteen columns, data-driven.
 * ================================================================
 *
 * The columns are a `readonly` array rather than eighteen hand-written
 * `<th>`/`<td>` pairs, so the header row and the body cells cannot drift: a
 * column exists in exactly one place, and `LicenceTable.test.tsx` asserts the
 * rendered header equals `COLUMNS` - which means a renamed header, a dropped
 * cell or a reordered column is one assertion away from a failure rather than
 * something a reviewer has to notice by eye across 1680px of table.
 *
 * THE ONE DEVIATION FROM §5's NUMBERING
 * -------------------------------------
 * §5 lists `Licence ID` second and §5's own footer says "keeping the No. and
 * Customer columns visible/sticky". Those two statements cannot both hold: a
 * sticky column has to sit at the left edge, so for Customer to be sticky it
 * must immediately follow No., and `Licence ID` at position 2 pushes it down.
 *
 * Resolution: swap positions 2 and 3, so the order is No. | Customer Email |
 * Licence ID | ... Every one of the eighteen headers is present, in an
 * otherwise identical order, and the frozen zone is exactly what §5's footer
 * asks for. The deviation is recorded here rather than made silently, because
 * a reader comparing this file against the spec line by line deserves to have
 * the difference explained instead of discovering it.
 *
 * Only `No.` and `Customer Email` are frozen (296px). Freezing the whole
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
import type { RowActionDecision, RowActionId } from "./actions";
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

/** `2026-10-01T10:00:00.000Z` -> `01 Oct 2026`. Unparseable -> em dash. */
export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Same, with the time, for the drawer and audit rows. */
export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatDate(value)} ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
}

/* ----------------------------------------------------------------- columns */

function dash(value: string | null | undefined): ReactNode {
  return value && value !== "" ? value : <span className="muted">—</span>;
}

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
    header: "Customer Email",
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
    id: "serialId",
    header: "Licence ID",
    render: (row) => <span className="mono">{row.serialId}</span>,
  },
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
  { id: "createdAt", header: "Created Date", render: (row) => formatDate(row.createdAt) },
  { id: "issuedAt", header: "Issued Date", render: (row) => formatDate(row.issuedAt) },
  {
    id: "firstActivatedAt",
    header: "Activation Date",
    render: (row) => formatDate(row.firstActivatedAt),
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
        <RowMenu
          actions={ctx.actions}
          rowLabel={row.customerEmail}
          onPick={(id) => ctx.onPick(row, id)}
        />
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
