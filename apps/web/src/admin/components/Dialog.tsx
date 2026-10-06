/**
 * §15 CONFIRMATION DIALOGUES, and the reason prompt they share.
 * ============================================================
 *
 * Two duties the spec states separately and one it implies:
 *
 *   §15  "High-impact actions should have confirmation." - shown for Issue
 *        Licence and the Super Admin payment waiver, with the exact facts the
 *        spec lists (customer, plan, payment) so the confirmation is about
 *        *this* licence and not about a button the operator clicked in the
 *        wrong row.
 *
 *   §26  A reason is required for Revoke - "The red action must require:
 *        confirmation, reason, authorized role, backend validation, audit
 *        event" - and RULE 12 repeats it. Suspend and the waiver carry one for
 *        the same reason: the server refuses without one, so the prompt is not
 *        decoration, it is the field the refusal is about, and §53 stores it.
 *
 *   The implied one: a confirmation whose confirm button is armed from the
 *    moment the dialog opens is a mechanism for doing the wrong thing faster.
 *    Required fields keep it disabled until they are filled, and `busy` keeps
 *    it disabled for the length of the request, so a slow network cannot be
 *    answered by clicking again.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

export interface DialogField {
  readonly name: string;
  readonly label: string;
  readonly help?: string;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly rows?: number;
  /**
   * Render a `<select>` instead of a text input.
   *
   * A free-text field invites an answer the database cannot store; §84 RULE 15
   * ("the browser should request an operation, the server must decide") is
   * about permission, but the same reasoning applies to vocabulary: a method
   * typed as "upi" vs "UPI" vs "PhonePe" is three spellings of one fact, and
   * `payment_method_enum` would refuse two of them at the driver, after the
   * operator has already watched the dialog close. Offering the exact set the
   * server admits means the failure - if there is one - is a 400 the operator
   * can read, not a 500 they cannot.
   *
   * Absent, a field is a text input, so this is purely additive: every dialog
   * that exists renders byte-for-byte as it did before.
   */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /**
   * The empty first option's label - "Select a payment method". A `<select>`
   * with no blank option is pre-answered on open, which for a mandatory field
   * means the confirm button arms itself with a value nobody chose. The blank
   * option is what makes the control require a decision rather than record the
   * absence of one.
   *
   * Only read when `options` is present.
   */
  readonly blankLabel?: string;
}

export interface ConfirmSpec {
  readonly title: string;
  readonly body: ReactNode;
  readonly confirmLabel: string;
  readonly tone?: "primary" | "danger" | "ready";
  readonly fields?: readonly DialogField[];
  /**
   * Shown above the fields when the action is a state-machine refusal the
   * server returned - never replaced by a generic error, because the server's
   * sentence names the state and the remedy.
   */
  readonly error?: string | null;
  /**
   * Starting field values. Used by Edit, where an empty form would read as
   * "these fields are blank" rather than "these are the current values" and
   * would submit blanks for everything the operator did not touch.
   */
  readonly initialValues?: Readonly<Record<string, string>>;
}

export interface ConfirmInput {
  readonly values: Record<string, string>;
}

export function ConfirmDialog({
  spec,
  busy = false,
  onCancel,
  onConfirm,
}: {
  spec: ConfirmSpec;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (input: ConfirmInput) => void;
}) {
  const titleId = useId();
  const [values, setValues] = useState<Record<string, string>>({
    ...(spec.initialValues ?? {}),
  });
  const [touched, setTouched] = useState(false);
  const first = useRef<HTMLElement | null>(null);
  /** Stable identity, so React does not detach and reattach the ref every render. */
  const setFirst = useCallback((node: HTMLElement | null) => {
    first.current = node;
  }, []);

  const fields = spec.fields ?? [];
  const missing = fields.filter(
    (field) => field.required !== false && (values[field.name] ?? "").trim() === "",
  );

  useEffect(() => {
    first.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (missing.length > 0 || busy) return;
    onConfirm({ values });
  }

  const tone = spec.tone ?? "primary";
  const confirmClass =
    tone === "danger" ? "btn btn--danger" : tone === "ready" ? "btn btn--ready" : "btn btn--primary";

  return (
    <div className="dialog-scrim" role="presentation">
      <form
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
      >
        <div className="dialog__head">
          <h2 className="dialog__title" id={titleId}>
            {spec.title}
          </h2>
        </div>

        <div className="dialog__body">
          {spec.body}

          {spec.error ? (
            <p className="notice notice--error" role="alert">
              {spec.error}
            </p>
          ) : null}

          {fields.map((field, index) => {
            const showRequired = touched && field.required !== false && !(values[field.name] ?? "").trim();
            return (
              <label className="field" key={field.name}>
                <span className="field__label">
                  {field.label}
                  {field.required !== false ? <span aria-hidden="true"> *</span> : null}
                </span>
                {field.options ? (
                  <select
                    className="input"
                    value={values[field.name] ?? ""}
                    ref={index === 0 ? setFirst : undefined}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.name]: event.target.value }))
                    }
                  >
                    {/* Blank first: see `DialogField.blankLabel` - a mandatory
                        control must not arrive pre-answered. */}
                    <option value="">{field.blankLabel ?? "Select…"}</option>
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.rows ? (
                  <textarea
                    className="input"
                    rows={field.rows}
                    placeholder={field.placeholder}
                    value={values[field.name] ?? ""}
                    ref={index === 0 ? setFirst : undefined}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.name]: event.target.value }))
                    }
                  />
                ) : (
                  <input
                    className="input"
                    placeholder={field.placeholder}
                    value={values[field.name] ?? ""}
                    ref={index === 0 ? setFirst : undefined}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.name]: event.target.value }))
                    }
                  />
                )}
                {field.help ? <span className="field__help">{field.help}</span> : null}
                {showRequired ? (
                  <span className="field__error">A {field.label.toLowerCase()} is required.</span>
                ) : null}
              </label>
            );
          })}
        </div>

        <div className="dialog__foot">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className={confirmClass}
            /*
             * `missing.length > 0` arms nothing.
             *
             * The header above has always claimed "Required fields keep it
             * disabled until they are filled", and `submit()` has always
             * *enforced* that - but the button itself stayed clickable and
             * silently did nothing on click, which is the worst of both: the
             * operator saw a live-looking button, pressed it, and was left
             * wondering whether the click had registered or the network had
             * dropped. Disabled is the honest rendering of "this cannot be
             * done yet", and it is what WS-H2's mandatory Payment Method
             * dropdown is specified to require.
             */
            disabled={busy || missing.length > 0}
          >
            {busy ? "Working…" : spec.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
