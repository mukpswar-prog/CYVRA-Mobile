/**
 * §43's control row: search, filters, quick-filter chips.
 *
 * SEARCH IS DEBOUNCED, SERVER-SIDE.
 * The input holds its own draft and writes to the query after 320ms of quiet.
 * Each keystroke must NOT become a request: the server refuses `q` over 200
 * characters with a 400, and a 400 on every character would make typing in
 * this field produce a stream of red banners. The debounce also means the
 * counter shown in the pager is always about a query the operator finished
 * typing, never about a half-typed one.
 *
 * CHIPS ARE SERVER-EXPRESSIBLE PRESETS ONLY.
 * Each chip maps to exactly one filter the API can serve. §42 proposes
 * `ALL / NEEDS ACTION / ACTIVE / ARCHIVED`, and "Needs Action" and "Archived"
 * are neither one filter nor a set of them: the queue spans three columns
 * (`licence_status`, `email_error`, `host_binding`) and cannot be asked for in
 * a single request, while summing separate totals would double-count a licence
 * that is both KEY_GENERATED and awaiting a rebind. A chip that quietly ran
 * half the query it claims is the "silently truncate" defect wearing a
 * different hat, so the five here are the five the server answers exactly, and
 * the full queue lives on the Dashboard where each item gets its own number.
 */
import { useEffect, useRef, useState } from "react";
import type { SerialQueryState } from "../client";
import { MultiSelect, type ChoiceOption } from "../components/MultiSelect";
import { KPIS, totalFor, type Totals } from "./totals";

export const LICENCE_STATUSES: readonly ChoiceOption[] = Object.freeze([
  { value: "DRAFT", label: "Draft" },
  { value: "PAYMENT_PENDING", label: "Payment pending" },
  { value: "PAYMENT_CONFIRMED", label: "Payment confirmed" },
  { value: "READY_TO_GENERATE", label: "Ready to generate" },
  { value: "KEY_GENERATED", label: "Key generated" },
  { value: "ISSUED", label: "Issued" },
  { value: "ACTIVE", label: "Active" },
  { value: "EXPIRED", label: "Expired" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "REVOKED", label: "Revoked" },
]);

export const PAYMENT_STATUSES: readonly ChoiceOption[] = Object.freeze([
  { value: "PENDING", label: "Pending" },
  { value: "PAID", label: "Paid" },
  { value: "PARTIALLY_PAID", label: "Partially paid" },
  { value: "REFUNDED", label: "Refunded" },
  { value: "CANCELLED", label: "Cancelled" },
]);

export const PLAN_CODES: readonly ChoiceOption[] = Object.freeze([
  { value: "CAP-1", label: "CAP-1", hint: "1–5 devices" },
  { value: "CAP-3", label: "CAP-3", hint: "legacy slab" },
  { value: "CAP-5", label: "CAP-5", hint: "legacy slab" },
  { value: "CAP-7", label: "CAP-7", hint: "legacy slab" },
  { value: "CAP-10", label: "CAP-10" },
  { value: "CAP-25", label: "CAP-25" },
  { value: "CAP-50", label: "CAP-50" },
]);

export const CUSTOMER_KINDS: readonly ChoiceOption[] = Object.freeze([
  { value: "SINGLE", label: "Single" },
  { value: "BULK", label: "Bulk" },
]);

export const HOST_BINDING: readonly ChoiceOption[] = Object.freeze([
  { value: "NOT_BOUND", label: "Not bound" },
  { value: "BOUND", label: "Bound" },
  { value: "REBIND_REQUEST", label: "Rebind requested" },
  { value: "LOCKED", label: "Locked" },
]);

/** ms of quiet before a keystroke becomes a request. */
export const SEARCH_DEBOUNCE_MS = 320;

export function Toolbar({
  query,
  patch,
  onClear,
}: {
  query: SerialQueryState;
  patch: (next: Partial<SerialQueryState>) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(query.q);
  const lastApplied = useRef(query.q);

  // The draft is pushed after a quiet period; a value that came from *outside*
  // (a chip, a KPI, a back navigation) replaces the draft immediately instead
  // of waiting, so the field never displays text that is not what is being
  // queried.
  useEffect(() => {
    if (draft === lastApplied.current) return;
    const timer = setTimeout(() => {
      lastApplied.current = draft;
      patch({ q: draft });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, patch]);

  useEffect(() => {
    if (query.q === lastApplied.current) return;
    lastApplied.current = query.q;
    setDraft(query.q);
  }, [query.q]);

  const dirty =
    query.q !== "" ||
    query.status.length > 0 ||
    query.paymentStatus.length > 0 ||
    query.planCode.length > 0 ||
    query.customerKind.length > 0 ||
    query.hostBinding.length > 0 ||
    query.delivery.length > 0 ||
    query.validityEndsWithinDays !== null;

  return (
    <div className="toolbar">
      <label className="toolbar__search">
        <span className="visually-hidden">
          Search licences by email, name, company, serial or note
        </span>
        <input
          className="input"
          type="search"
          placeholder="Search customer, company, serial…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>

      <MultiSelect
        label="Payment"
        placeholder="Payment"
        options={PAYMENT_STATUSES}
        selected={query.paymentStatus}
        onChange={(value) => patch({ paymentStatus: value })}
      />
      <MultiSelect
        label="Licence status"
        placeholder="Status"
        options={LICENCE_STATUSES}
        selected={query.status}
        onChange={(value) => patch({ status: value })}
      />
      <MultiSelect
        label="Plan"
        placeholder="Plan"
        options={PLAN_CODES}
        selected={query.planCode}
        onChange={(value) => patch({ planCode: value })}
      />
      <MultiSelect
        label="Customer type"
        placeholder="Customer type"
        options={CUSTOMER_KINDS}
        selected={query.customerKind}
        onChange={(value) => patch({ customerKind: value })}
      />
      <MultiSelect
        label="Host binding"
        placeholder="Host binding"
        options={HOST_BINDING}
        selected={query.hostBinding}
        onChange={(value) => patch({ hostBinding: value })}
      />

      {dirty ? (
        <button type="button" className="btn btn--sm" onClick={onClear}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

/**
 * The quick-filter chips, each carrying its server total.
 *
 * Counts come from the same `useServerTotals` batch as the strip above, so a
 * chip and the card it mirrors can never disagree - they are the same number
 * read twice.
 */
export function ChipBar({
  query,
  patch,
  totals,
  loading,
}: {
  query: SerialQueryState;
  patch: (next: Partial<SerialQueryState>) => void;
  totals: Totals;
  loading: boolean;
}) {
  const options = [
    { label: "All", patch: {}, active: isAllActive(query) },
    ...KPIS.filter((kpi) => kpi.id !== "total").map((kpi) => ({
      label: kpi.label,
      patch: kpi.patch,
      active: matchesPatch(query, kpi.patch),
    })),
  ];

  return (
    <div className="chips" role="group" aria-label="Quick filters">
      {options.map((option) => {
        const count = totalFor(totals, option.patch);
        return (
          <button
            key={option.label}
            type="button"
            className="chip"
            aria-pressed={option.active}
            onClick={() => patch(option.patch)}
          >
            {option.label}
            <span className="muted" style={{ marginLeft: 6, fontWeight: 700 }}>
              {count === null ? (loading ? "…" : "—") : count.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function isAllActive(query: SerialQueryState): boolean {
  return matchesPatch(query, {});
}

/** Does this query equal exactly this patch, with nothing else set? */
function matchesPatch(query: SerialQueryState, patch: Partial<SerialQueryState>): boolean {
  const status = patch.status ?? [];
  const paymentStatus = patch.paymentStatus ?? [];
  const planCode = patch.planCode ?? [];
  const customerKind = patch.customerKind ?? [];
  const hostBinding = patch.hostBinding ?? [];
  const delivery = patch.delivery ?? [];
  const expiry = patch.validityEndsWithinDays ?? null;
  return (
    sameList(query.status, status) &&
    sameList(query.paymentStatus, paymentStatus) &&
    sameList(query.planCode, planCode) &&
    sameList(query.customerKind, customerKind) &&
    sameList(query.hostBinding, hostBinding) &&
    sameList(query.delivery, delivery) &&
    query.validityEndsWithinDays === expiry &&
    query.q === ""
  );
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
