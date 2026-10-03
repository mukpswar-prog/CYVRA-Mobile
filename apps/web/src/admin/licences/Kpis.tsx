/**
 * §43's quick summary strip and §42's Needs Action queue.
 *
 * Both render `useServerTotals` output - `pagination.total` from a count-only
 * server request - and neither ever sums rows. That is the whole design, and
 * the parts worth stating are the failure modes it avoids:
 *
 * - A figure that is still loading renders as "…" (see `KpiValue`), not as 0.
 *   A zero is a claim about the database; an ellipsis is a claim about the
 *   network. They look nothing alike and only one of them is safe to read.
 * - A figure that failed renders as "—" with a banner saying how many failed,
 *   rather than as a silent blank. Five cards where three loaded must not be
 *   mistaken for five cards where three were found.
 * - The queue is five *separate* numbers, never a summed "Needs Action" total.
 *   Failed delivery lives in `email_error` and a rebind in `host_binding`, the
 *   three statuses live in `licence_status`, and one licence can be both
 *   KEY_GENERATED and awaiting a rebind - so adding them would double-count a
 *   row while looking perfectly reasonable. See `totals.ts`.
 */
import type { ReactNode } from "react";
import { Notice } from "../components/kit";
import { KPIS, QUEUE, totalFor, type KpiDef, type Totals } from "./totals";
import type { SerialQueryState } from "../client";

export interface Selectable {
  /** Apply this definition's filter to the registry and open it. */
  onSelect: (patch: Partial<SerialQueryState>) => void;
  /** Which chip is currently pressed, when the strip doubles as a filter. */
  activePatch?: Partial<SerialQueryState> | null;
}

function KpiValue({ value, loading }: { value: number | null; loading: boolean }) {
  if (value !== null) return <span className="kpi__value">{value.toLocaleString()}</span>;
  return (
    <span className="kpi__value kpi__value--unknown" aria-busy={loading}>
      {loading ? "…" : "—"}
    </span>
  );
}

export function KpiStrip({
  totals,
  loading,
  onSelect,
  activePatch,
}: { totals: Totals; loading: boolean } & Selectable) {
  return (
    <section aria-label="Licence summary">
      <div className="row row--wrap" style={{ marginBottom: 12, justifyContent: "space-between" }}>
        <h2 className="card__title">At a glance</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          Counts are read from the server's pagination totals, not from the rows on screen.
        </span>
      </div>

      {totals.error ? (
        <div style={{ marginBottom: 12 }}>
          <Notice kind="warn">{totals.error}</Notice>
        </div>
      ) : null}

      <div className="kpis">
        {KPIS.map((kpi) => (
          <KpiCard
            key={kpi.id}
            def={kpi}
            value={totalFor(totals, kpi.patch)}
            loading={loading}
            active={isActive(kpi.patch, activePatch)}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function KpiCard({
  def,
  value,
  loading,
  active,
  onSelect,
}: {
  def: KpiDef;
  value: number | null;
  loading: boolean;
  active: boolean;
  onSelect: (patch: Partial<SerialQueryState>) => void;
}) {
  return (
    <button
      type="button"
      className={`kpi kpi--${def.tone}`}
      aria-pressed={active}
      onClick={() => onSelect(def.patch)}
      title={`Filter the registry to ${def.label.toLowerCase()}`}
    >
      <span className="kpi__label">{def.label}</span>
      <KpiValue value={value} loading={loading} />
    </button>
  );
}

/** Structural equality over the patch, so a rebuilt array literal is still "active". */
export function isActive(
  a: Partial<SerialQueryState> | null | undefined,
  b: Partial<SerialQueryState> | null | undefined,
): boolean {
  if (!a || !b) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((key, index) => key !== kb[index])) return false;
  return ka.every((key) => {
    const va = (a as Record<string, unknown>)[key];
    const vb = (b as Record<string, unknown>)[key];
    if (Array.isArray(va) && Array.isArray(vb)) {
      return va.length === vb.length && va.every((item, i) => item === vb[i]);
    }
    return va === vb;
  });
}

export function NeedsAction({
  totals,
  loading,
  onSelect,
  disabled,
  footer,
}: Selectable & {
  totals: Totals;
  loading: boolean;
  disabled?: boolean;
  footer?: ReactNode;
}) {
  return (
    <section className="card" aria-label="Needs action">
      <div className="card__head">
        <h2 className="card__title">Needs action</h2>
        <p className="card__hint">
          §42's five queues, each counted by its own server query. Selecting one opens the
          registry already filtered to it.
        </p>
      </div>

      <div className="queue">
        {QUEUE.map((item) => {
          const value = totalFor(totals, item.patch);
          return (
            <button
              key={item.id}
              type="button"
              className="queue__item"
              disabled={disabled}
              onClick={() => onSelect(item.patch)}
            >
              <span className="queue__name">
                <span className={`badge badge--${item.tone}`}>{item.label}</span>
              </span>
              <span className="queue__count">
                {value === null ? (loading ? "…" : "—") : value.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>
      {footer}
    </section>
  );
}
