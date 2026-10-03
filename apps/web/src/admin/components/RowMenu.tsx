/**
 * The row's three-dot menu (§14).
 *
 * All twelve actions are rendered in every row, always, in `ROW_ACTION_IDS`
 * order. The tempting alternative - omitting the ones that cannot run - fails
 * §14's second clause differently: an operator would never learn that Suspend
 * exists until a licence reached Issued, and would then have no way to find
 * out what it needs. So the impossible entries are present, disabled, and each
 * one *says why* in the entry itself.
 *
 * THE TOOLTIP, HONESTLY
 * ---------------------
 * The brief asks for a tooltip. `title` on a `disabled` button is not reliable
 * - Chrome does not raise it for disabled controls, because a disabled element
 * does not take pointer events - so a reason that existed only there would
 * satisfy the brief on the browser it was checked in and fail everywhere else.
 * The reason is therefore rendered as a visible second line inside the entry,
 * and `title` is added as a bonus for the browsers that do show it. The
 * visible line is the guarantee; the attribute is not.
 */
import { useEffect, useRef, useState } from "react";
import type { RowActionDecision, RowActionId } from "../licences/actions";

/** Ids below a divider, so a destructive click is never the next pixel. */
const DANGEROUS: readonly RowActionId[] = ["suspend", "revoke"];

export function RowMenu({
  actions,
  onPick,
  rowLabel,
}: {
  actions: readonly RowActionDecision[];
  onPick: (id: RowActionId, action: RowActionDecision) => void;
  /** For `aria-label`, e.g. the customer email or the masked key. */
  rowLabel: string;
}) {
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

  let dividerPlaced = false;

  return (
    <div className="rowmenu" ref={root}>
      <button
        type="button"
        className="rowmenu__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Actions for ${rowLabel}`}
        onClick={() => setOpen((value) => !value)}
      >
        ⋮
      </button>

      {open ? (
        <div className="rowmenu__panel" role="menu" aria-label={`Actions for ${rowLabel}`}>
          {actions.map((action, index) => {
            const showDivider = !dividerPlaced && DANGEROUS.includes(action.id) && index > 0;
            if (showDivider) dividerPlaced = true;
            return (
              <div key={action.id}>
                {showDivider ? <div className="rowmenu__sep" role="separator" /> : null}
                <button
                  type="button"
                  role="menuitem"
                  className={`rowmenu__item${action.danger ? " rowmenu__item--danger" : ""}`}
                  disabled={!action.enabled}
                  title={action.reason ?? undefined}
                  onClick={() => {
                    setOpen(false);
                    onPick(action.id, action);
                  }}
                >
                  <span>
                    {action.label}
                    {action.ready ? <span aria-hidden="true"> ●</span> : null}
                  </span>
                  {action.reason ? <span className="rowmenu__why">{action.reason}</span> : null}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
