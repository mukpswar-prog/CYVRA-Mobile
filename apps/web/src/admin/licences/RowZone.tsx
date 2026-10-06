/**
 * §25 / §66 / §82's ROW ACTION ZONE.
 * ==================================
 *
 * §66 is titled "EXACT ROW ACTION RULE" and it is the rule this file implements
 * verbatim:
 *
 *     payment-confirmed, issuable  ->  [ ISSUE LICENCE ·GREEN ]  [ REVOKE ·RED ]
 *     payment-pending              ->  [ ISSUE LICENCE ·GREY  ]  [ REVOKE ]
 *     active licence               ->  [ VIEW ]                  [ REVOKE ]
 *
 *     "The UI should not show an impossible operation as enabled."
 *
 * §25 adds that Revoke must stay *obvious* even where it cannot run - "the
 * operational design must make the control obvious" - so it is never omitted,
 * only disabled with the sentence §14 requires. §28's state table agrees:
 * Payment Pending (issue disabled, revoke per policy), Ready to Issue (green,
 * red), Active (issue unavailable, revoke red), Revoked (both unavailable).
 *
 * WHY THE PRIMARY SWAPS TO VIEW
 * -----------------------------
 * Because §66 says so, and because the alternative is the exact failure the
 * section forbids: leaving a grey Issue Licence on an ACTIVE row advertises an
 * operation the server would refuse. The swap is derived from `row.status` and
 * the shared decision list, never from click history - two rows in the same
 * state render the same zone.
 *
 * ONE BUTTON, NOT A SPLIT
 * -----------------------
 * Issue means exactly one thing here: the ordinary §20 path, which provisions
 * and issues inside a single transaction (Path 6B). There is no second flavour
 * of it behind a caret, so a green Issue button can never quietly mean
 * something other than "payment is recorded, this will issue".
 */
import type { RowActionDecision, RowActionId } from "./actions";

/** The states §66 draws with `[ ISSUE LICENCE ]` in the row (grey or green). */
const PRE_ISSUE = new Set([
  "DRAFT",
  "PAYMENT_PENDING",
  "PAYMENT_CONFIRMED",
  "READY_TO_GENERATE",
  "KEY_GENERATED",
]);

function byId(
  actions: readonly RowActionDecision[],
  id: RowActionId,
): RowActionDecision | undefined {
  return actions.find((action) => action.id === id);
}

/**
 * The Issue control.
 *
 * Rendered by both the row zone and the drawer footer, so those two cannot end
 * up offering different answers to "may this licence be issued, and is it
 * green?".
 */
export function IssueButton({
  status,
  actions,
  onPick,
}: {
  status: string;
  actions: readonly RowActionDecision[];
  onPick: (id: RowActionId) => void;
}) {
  const issue = byId(actions, "approveIssue");
  const view = byId(actions, "view");
  if (!issue || !view) return null;

  // §66: once the licence has been issued the row offers VIEW instead, because
  // an Issue button there is an operation that cannot be performed.
  const primary = PRE_ISSUE.has(status) ? issue : view;

  const className = !primary.enabled
    ? "btn"
    : primary.id === "approveIssue"
      ? primary.ready
        ? // §20's GREEN is about money, so it is green only when both the
          // state and the payment say so.
          "btn btn--ready"
        : "btn btn--primary"
      : "btn";

  return (
    <button
      type="button"
      className={className}
      disabled={!primary.enabled}
      title={primary.reason ?? undefined}
      onClick={() => onPick(primary.id)}
    >
      {primary.label}
    </button>
  );
}

/**
 * The visible end-of-row pair: Issue, then Revoke.
 *
 * Revoke is `btn--danger` whether or not it can run, so a revoked or draft row
 * still shows the red control §25 asks to be kept obvious - disabled, and with
 * the refusal sentence in its `title` and its tooltip.
 */
export function RowZone({
  status,
  actions,
  onPick,
  rowLabel,
}: {
  status: string;
  actions: readonly RowActionDecision[];
  onPick: (id: RowActionId) => void;
  rowLabel: string;
}) {
  const revoke = byId(actions, "revoke");
  if (!revoke) return null;

  return (
    <div className="rowzone">
      <IssueButton status={status} actions={actions} onPick={onPick} />
      <button
        type="button"
        className="btn btn--danger"
        disabled={!revoke.enabled}
        title={revoke.reason ?? undefined}
        aria-label={`Revoke licence for ${rowLabel}`}
        onClick={() => onPick(revoke.id)}
      >
        {revoke.label}
      </button>
    </div>
  );
}
