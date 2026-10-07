import { useState, type ReactNode } from "react";
import "./steel.css";

/*
 * Spec 70 — UI COMPONENT SYSTEM.
 *
 * "Use reusable components. ... Do not create one-off visual styles for every
 * screen."
 *
 * Every component below is a headless-ish container driven by props: the shell
 * supplies data, the kit supplies structure. Screens compose these instead of
 * declaring their own styles, which is what keeps Spec 4's colour semantics
 * consistent across the Workspace.
 *
 * Spec 4 also forbids communicating a critical state by colour alone, so every
 * StatusBadge carries a text label and no component renders a bare colour.
 */

/** Spec 4 colour semantics. */
export type Tone = "success" | "danger" | "action" | "neutral";

/* ------------------------------------------------------------------ *
 * Spec 70 list (17 components)
 * ------------------------------------------------------------------ */

/** 1. Steel card — the default container. */
export function SteelCard(props: {
  title?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** `true` removes body padding, for tables that manage their own. */
  flush?: boolean;
}) {
  const { title, badge, children, footer, flush } = props;
  return (
    <section className="ws-card">
      {title ? (
        <div className="ws-card__head">
          <h3 className="ws-card__title">{title}</h3>
          {badge}
        </div>
      ) : null}
      <div className={flush ? "ws-card__body ws-card__body--flush" : "ws-card__body"}>
        {children}
      </div>
      {footer ? <div className="ws-card__foot">{footer}</div> : null}
    </section>
  );
}

/** 2. Status badge — always paired with a label (Spec 4). */
export function StatusBadge(props: { tone?: Tone; children: ReactNode }) {
  const { tone = "neutral", children } = props;
  return <span className={`ws-badge ws-badge--${tone}`}>{children}</span>;
}

/** 3. Licence card — the licence projection, row by row. */
export function LicenceCard(props: {
  title: ReactNode;
  badge?: ReactNode;
  rows: { key: ReactNode; value: ReactNode }[];
  footer?: ReactNode;
}) {
  return (
    <SteelCard title={props.title} badge={props.badge} footer={props.footer}>
      <dl style={{ margin: 0 }}>
        {props.rows.map((row, i) => (
          <div className="ws-licence__row" key={i}>
            <dt className="ws-licence__key">{row.key}</dt>
            <dd className="ws-licence__val" style={{ margin: 0 }}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </SteelCard>
  );
}

/** 4. Metric card. */
export function MetricCard(props: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Exclude<Tone, "action"> | "action";
}) {
  const { label, value, hint, tone } = props;
  const valueClass =
    tone === "success"
      ? "ws-metric__value ws-metric__value--success"
      : tone === "danger"
        ? "ws-metric__value ws-metric__value--danger"
        : tone === "action"
          ? "ws-metric__value ws-metric__value--action"
          : "ws-metric__value";
  return (
    <div className="ws-metric">
      <span className="ws-metric__label">{label}</span>
      <span className={valueClass}>{value}</span>
      {hint ? <span className="ws-metric__hint">{hint}</span> : null}
    </div>
  );
}

/** 5. Data table — horizontally scrollable below its min-width (Spec 71). */
export function DataTable<Row>(props: {
  columns: { key: string; header: ReactNode; render: (row: Row) => ReactNode }[];
  rows: Row[];
  rowKey: (row: Row) => string;
  empty?: ReactNode;
}) {
  const { columns, rows, rowKey, empty } = props;
  return (
    <div className="ws-table-wrap">
      <table className="ws-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && empty ? (
        <div className="ws-empty" style={{ margin: 16 }}>
          {empty}
        </div>
      ) : null}
    </div>
  );
}

/** 6. Evidence accordion — Spec 71's small-screen treatment for domains. */
export function EvidenceAccordion(props: {
  items: { id: string; title: ReactNode; body: ReactNode }[];
  defaultOpenId?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(props.defaultOpenId ?? null);
  return (
    <div className="ws-accordion">
      {props.items.map((item) => {
        const open = openId === item.id;
        return (
          <div className="ws-accordion__item" key={item.id}>
            <button
              type="button"
              className="ws-accordion__trigger"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : item.id)}
            >
              <span>{item.title}</span>
              <span aria-hidden="true">{open ? "\u2212" : "+"}</span>
            </button>
            {open ? <div className="ws-accordion__panel">{item.body}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

/** 7. Upload panel — Spec 17's raw report intake surface. */
export function UploadPanel(props: {
  title: ReactNode;
  hint?: ReactNode;
  accept?: string;
  onFile?: (file: File | null) => void;
  children?: ReactNode;
}) {
  return (
    <div className="ws-upload">
      <strong>{props.title}</strong>
      {props.hint ? <span className="ws-upload__hint">{props.hint}</span> : null}
      <input
        type="file"
        accept={props.accept}
        onChange={(e) => props.onFile?.(e.target.files?.[0] ?? null)}
        aria-label={typeof props.title === "string" ? props.title : "Upload file"}
      />
      {props.children}
    </div>
  );
}

/** 8. Timeline. */
export function Timeline(props: {
  items: { id: string; title: ReactNode; meta?: ReactNode }[];
}) {
  return (
    <ol className="ws-timeline">
      {props.items.map((item) => (
        <li className="ws-timeline__item" key={item.id}>
          <div className="ws-timeline__title">{item.title}</div>
          {item.meta ? <div className="ws-timeline__meta">{item.meta}</div> : null}
        </li>
      ))}
    </ol>
  );
}

/** 9. Stepper — steps already passed read as done, the active one as current. */
export function Stepper(props: {
  steps: { id: string; label: ReactNode }[];
  currentId: string;
}) {
  let reachedCurrent = false;
  return (
    <ol className="ws-stepper">
      {props.steps.map((step) => {
        const isCurrent = step.id === props.currentId;
        const state = isCurrent ? "current" : reachedCurrent ? "todo" : "done";
        if (isCurrent) reachedCurrent = true;
        return (
          <li className="ws-stepper__item" data-state={state} key={step.id}>
            <span className="ws-stepper__num" aria-hidden="true">
              {state === "done" ? "\u2713" : ""}
            </span>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

/** 10. Modal. */
export function Modal(props: {
  title: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="ws-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="ws-modal" role="dialog" aria-modal="true" aria-label="dialog">
        <div className="ws-modal__head">
          <h3 className="ws-modal__title">{props.title}</h3>
          <button type="button" className="ws-modal__close" onClick={props.onClose} aria-label="Close">
            {"\u00d7"}
          </button>
        </div>
        <div className="ws-modal__body">{props.children}</div>
        {props.footer ? <div className="ws-modal__foot">{props.footer}</div> : null}
      </div>
    </div>
  );
}

/** 11. Confirmation dialog. */
export function ConfirmationDialog(props: {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!props.open) return null;
  return (
    <Modal
      title={props.title}
      onClose={props.onCancel}
      footer={
        <>
          <button type="button" className="ws-btn ws-btn--ghost" onClick={props.onCancel}>
            {props.cancelLabel ?? "Cancel"}
          </button>
          <button type="button" className="ws-btn ws-btn--danger" onClick={props.onConfirm}>
            {props.confirmLabel ?? "Confirm"}
          </button>
        </>
      }
    >
      <p className="ws-panel__text">{props.message}</p>
    </Modal>
  );
}

/** 12. Error panel. */
export function ErrorPanel(props: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="ws-panel ws-panel--error" role="alert">
      <h4 className="ws-panel__title">{props.title}</h4>
      {props.children ? <p className="ws-panel__text">{props.children}</p> : null}
    </div>
  );
}

/** 13. Success panel. */
export function SuccessPanel(props: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="ws-panel ws-panel--success" role="status">
      <h4 className="ws-panel__title">{props.title}</h4>
      {props.children ? <p className="ws-panel__text">{props.children}</p> : null}
    </div>
  );
}

/**
 * 14. Download button — ORANGE (Spec 4/13). Disabled rather than hidden when no
 * authorized release exists, so the control never implies a file is available.
 */
export function DownloadButton(props: {
  href?: string | null;
  label: ReactNode;
  disabledLabel?: ReactNode;
  downloadName?: string;
}) {
  if (!props.href) {
    return (
      <button type="button" className="ws-btn ws-btn--ghost" disabled>
        {props.disabledLabel ?? props.label}
      </button>
    );
  }
  return (
    <a
      className="ws-btn ws-btn--action"
      href={props.href}
      download={props.downloadName ?? undefined}
    >
      {props.label}
    </a>
  );
}

/** 15. Filter bar. */
export function FilterBar(props: { children?: ReactNode }) {
  return <div className="ws-filterbar">{props.children}</div>;
}

/** 16. Search. */
export function Search(props: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <input
      type="search"
      className="ws-search"
      value={props.value}
      placeholder={props.placeholder ?? "Search\u2026"}
      aria-label={props.label ?? "Search"}
      onChange={(e) => props.onValueChange(e.target.value)}
    />
  );
}

/** 17. Pagination. */
export function Pagination(props: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  const { page, pageCount, onPageChange } = props;
  const safeCount = Math.max(1, pageCount);
  return (
    <nav className="ws-pagination" aria-label="Pagination">
      <button
        type="button"
        className="ws-btn ws-btn--ghost ws-btn--sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {safeCount}
      </span>
      <button
        type="button"
        className="ws-btn ws-btn--ghost ws-btn--sm"
        disabled={page >= safeCount}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
