/**
 * A multi-select filter.
 *
 * Native `<select multiple>` is not usable in a table toolbar: it needs a
 * modifier key to add an option, it renders as a list box with no room for the
 * status vocabulary's hints, and its keyboard model in jsdom and in older
 * browsers differs enough that a test proving "two filters applied" would be
 * proving a browser behaviour rather than a decision.
 *
 * So: a button that reports how many are selected (so the collapsed control
 * never hides that a filter is active - a silent filter is how a table comes
 * back "empty" for ten minutes), a checkbox panel, and an outside-click handler
 * so the panel does not need a click on an exact pixel to dismiss.
 */
import { useEffect, useRef, useState } from "react";

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
  /** Secondary line - used for the status vocabulary's "what this includes". */
  readonly hint?: string;
}

export interface MultiSelectProps {
  label: string;
  options: readonly ChoiceOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  /** Shown when nothing is selected, in place of the bare label. */
  placeholder?: string;
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chosen = selected.length;

  function toggle(value: string) {
    onChange(
      chosen === 0
        ? [value]
        : selected.includes(value)
          ? selected.filter((item) => item !== value)
          : [...selected, value],
    );
  }

  return (
    <div className="msel" ref={root}>
      <button
        type="button"
        className="msel__button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{chosen > 0 ? label : (placeholder ?? label)}</span>
        {chosen > 0 ? <span className="msel__count">{chosen}</span> : <span aria-hidden="true">▾</span>}
      </button>

      {open ? (
        <div className="msel__panel" role="group" aria-label={`${label} options`}>
          {options.length === 0 ? (
            <p className="muted" style={{ padding: "6px 8px", margin: 0 }}>
              No options.
            </p>
          ) : null}
          {options.map((option) => {
            const on = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="checkbox"
                aria-checked={on}
                className="msel__option"
                onClick={() => toggle(option.value)}
              >
                <span className={`msel__box${on ? " msel__box--on" : ""}`} aria-hidden="true">
                  {on ? "✓" : ""}
                </span>
                <span>
                  {option.label}
                  {option.hint ? <span className="cell-sub">{option.hint}</span> : null}
                </span>
              </button>
            );
          })}
          {chosen > 0 ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              style={{ marginTop: 4 }}
              onClick={() => onChange([])}
            >
              Clear {label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
