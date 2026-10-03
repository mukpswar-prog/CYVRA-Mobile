/**
 * Small shared pieces. Nothing here fetches, routes or decides - each one
 * takes a value and renders it, which is why the status vocabulary lives in
 * `tone.ts` and not in this file.
 */
import type { ReactNode } from "react";
import type { BadgeView } from "./tone";

/**
 * Text + colour, always both.
 *
 * The `tone` sets a class and the class sets a background and a foreground
 * that were chosen together to clear 4.5:1. `view.text` is never derived from
 * the tone - a badge whose only content is a colour would break the rule for a
 * reader with no colour perception, in a monochrome print, or in a screenshot
 * pasted into a ticket, all of which are ordinary ways to read a console.
 */
export function Badge({ view, title }: { view: BadgeView; title?: string }) {
  if (view.text === "—") {
    return (
      <span className="badge badge--none" title={title}>
        —
      </span>
    );
  }
  return (
    <span className={`badge badge--${view.tone}`} title={title}>
      {view.text}
    </span>
  );
}

export function Notice({
  kind = "info",
  children,
}: {
  kind?: "info" | "warn" | "error";
  children: ReactNode;
}) {
  const cls = kind === "error" ? "notice notice--error" : kind === "warn" ? "notice notice--warn" : "notice";
  return <div className={cls}>{children}</div>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="row" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{label}</span>
    </span>
  );
}

export function Field({
  label,
  help,
  error,
  children,
  htmlFor,
}: {
  label: string;
  help?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field__label">{label}</span>
      {children}
      {error ? (
        <span className="field__error">{error}</span>
      ) : help ? (
        <span className="field__help">{help}</span>
      ) : null}
    </label>
  );
}
