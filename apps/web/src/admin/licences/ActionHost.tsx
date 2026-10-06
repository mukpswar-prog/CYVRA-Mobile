/**
 * ROW ACTION -> §22 DIALOG -> REQUEST. One place, both halves.
 * ===========================================================
 *
 * Two exported pieces, deliberately split:
 *
 *   `dialogFor` is PURE. It turns `(action, subject)` into the dialog the spec
 *   calls for - title, the facts §22's ISSUE CONFIRMATION DIALOG lists, the
 *   confirm button's label and tone, and the reason field when one is required
 *   (§26's Revoke dialog, stored as §53's `Reason / Note`). Because it is pure
 *   it can be asserted for all eleven actions without a DOM, which is how
 *   `dialog.test.ts` pins "Issue Licence's body names the customer, the plan
 *   and the payment" without depending on rendering.
 *
 *   `ActionHost` does the I/O. It owns busy/error state and the request, so no
 *   caller can dispatch a destructive action without going through the
 *   confirmation that the spec attaches to it.
 *
 * ACTIONS WITH NO DIALOG
 * ----------------------
 * `view`, `viewAudit` and `viewActivation` navigate rather than confirm, and
 * `exportRecord` downloads - none of them change state, so §15 does not apply.
 * They are handled by the caller before `dialogFor` is consulted; `dialogFor`
 * returns `null` for them so an unhandled id fails loudly rather than opening
 * an empty confirmation for an action that would then never run.
 */
import { useState } from "react";
import { adminClient, AdminHttpError } from "../client";
import { ConfirmDialog, type ConfirmSpec, type ConfirmInput } from "../components/Dialog";
import type { ActionableLicence, RowActionId } from "./actions";
import { PAYMENT_METHODS } from "./paymentMethod";

/** Everything a dialog needs to name *this* licence, from either projection. */
export type ActionSubject = ActionableLicence & {
  readonly serialId: string;
  readonly customerEmail: string;
  readonly planCode: string;
  readonly deviceMax: number;
  /**
   * Optional because only the Edit dialog reads them, and because a caller may
   * hold a projection that deliberately does not carry them. Both real
   * projections (`LicenceListItem`, `LicenceRecord`) do supply them, so in
   * practice the edit form always starts full rather than blank.
   */
  readonly customerFullName?: string | null;
  readonly companyName?: string | null;
  readonly paymentNoted?: string;
};

/**
 * The request for one action.
 *
 * Deliberately carries only the *id* and the row: what each action asks for is
 * decided by `dialogFor`, so a caller cannot hand it a decision that disagrees
 * with the row it is about.
 */
export type PendingAction = {
  readonly id: RowActionId;
  readonly subject: ActionSubject;
};

/* ----------------------------------------------------------------- dialog */

function facts(subject: ActionSubject) {
  return (
    <div className="dl" style={{ marginBottom: 12 }}>
      <dt>Customer</dt>
      <dd>{subject.customerEmail}</dd>
      <dt>Plan</dt>
      <dd>
        {subject.planCode} ({subject.deviceMax} Mobile Devices)
      </dd>
      <dt>Payment</dt>
      <dd>{subject.paymentStatus ?? "No record"}</dd>
    </div>
  );
}

const REASON_FIELD = {
  name: "reason",
  label: "Reason",
  required: true,
  rows: 3,
  help: "Recorded against the audit row as the §53 reason. It cannot be empty.",
  placeholder: "Why is this happening?",
} as const;

export function dialogFor(
  pending: PendingAction,
  roleLabel: string,
): ConfirmSpec | null {
  const { id, subject } = pending;

  switch (id) {
    case "confirmPayment":
      return {
        title: "Confirm Payment?",
        body: (
          <>
            {facts(subject)}
            <p>
              This records the payment as received and moves the licence to{" "}
              <strong>Payment confirmed</strong>, which is what turns Issue Licence green.
            </p>
          </>
        ),
        confirmLabel: "Confirm Payment",
        /*
         * PAYMENT METHOD IS MANDATORY, AND THE BLANK OPTION IS WHY.
         *
         * §12's flow says the operator presses "Confirm Payment" as the step
         * that makes a licence issuable, and §18 lists what that action has to
         * record. The Design Freeze does not list a method among them - see
         * `paymentMethod.ts` - so this field is a WS-H2 addition, and an
         * addition to an audit trail has to be *asserted* rather than
         * defaulted: a pre-selected value would write "UPI" into the trail for
         * a cheque payment simply because UPI was first in the list.
         *
         * `required` + `blankLabel` is the mechanism: the control opens on an
         * empty option, `ConfirmDialog` computes `missing` from it, and the
         * confirm button stays disabled until an operator picks. The server
         * refuses the same body, so skipping the UI buys nothing - see
         * `readPaymentMethod` in `services/api/src/admin.ts`.
         */
        fields: [
          {
            name: "paymentMethod",
            label: "Payment method",
            required: true,
            blankLabel: "Select a payment method…",
            options: PAYMENT_METHODS,
            help: "Stored on the payment and written into the audit trail with this confirmation.",
          },
          {
            name: "reference",
            label: "Payment reference (optional)",
            required: false,
            placeholder: "UPI ref, bank reference, note",
            help: "Stored with the payment so the trail can be reconciled later.",
          },
        ],
      };

    case "approveIssue":
      return {
        title: "Issue Licence?",
        body: (
          <>
            {facts(subject)}
            <p>
              One action provisions the signed credential, marks this licence{" "}
              <strong>Issued</strong> and queues the customer&apos;s email, all inside a single
              transaction. A retry after a lost connection returns this same result rather than
              issuing twice.
            </p>
            <p>Once issued, this licence will be available for customer activation.</p>
          </>
        ),
        confirmLabel: "Issue Licence",
        tone: "primary",
      };

    case "resend":
      return {
        title: "Resend Licence?",
        body: (
          <>
            {facts(subject)}
            <p>
              The licence is re-distributed to the customer's address. Nothing about the key
              or the licence state changes.
            </p>
          </>
        ),
        confirmLabel: "Resend Licence",
      };

    case "suspend":
      return {
        title: "Suspend Licence?",
        body: (
          <>
            {facts(subject)}
            <p>
              A suspended licence stops activating until it is reactivated. Suspension is
              reversible; revocation is not.
            </p>
          </>
        ),
        confirmLabel: "Suspend",
        tone: "danger",
        fields: [REASON_FIELD],
      };

    case "revoke":
      return {
        title: "Revoke Licence?",
        body: (
          <>
            {facts(subject)}
            <p className="notice notice--error">
              Revocation is permanent. The key stops working and the licence cannot be
              reactivated.
            </p>
          </>
        ),
        confirmLabel: "Revoke",
        tone: "danger",
        fields: [REASON_FIELD],
      };

    case "requestRebind":
      return {
        title: "Request Host Rebind?",
        body: (
          <>
            {facts(subject)}
            <p>
              Queues a rebind of this licence's single host. Approval - by a Licence Admin or
              the Super Admin - clears the binding so the customer can move to a new machine.
            </p>
          </>
        ),
        confirmLabel: "Request Rebind",
        fields: [
          { ...REASON_FIELD, required: false, help: "Optional, but it is what the approver will read first." },
        ],
      };

    case "edit":
      return {
        title: "Edit Customer Details",
        body: (
          <>
            {facts(subject)}
            <p className="field__help">
              Plan and capacity are frozen for the life of the licence and are not editable
              here. Everything below stops being editable once the licence reaches Issued.
            </p>
          </>
        ),
        confirmLabel: "Save changes",
        fields: [
          { name: "customerEmail", label: "Customer email", required: true },
          { name: "customerFullName", label: "Customer name", required: false },
          { name: "companyName", label: "Company", required: false },
          {
            name: "paymentNoted",
            label: "Payment note",
            required: false,
            help: "Free text recorded against the record.",
          },
        ],
      };

    case "view":
    case "viewActivation":
    case "viewAudit":
    case "exportRecord":
      return null;

    default: {
      // Unreachable while `RowActionId` and this switch stay in step; kept so a
      // newly added action cannot quietly render an empty dialog that confirms
      // nothing while appearing to do something.
      const never: never = id;
      throw new Error(`no dialog defined for action ${String(never)} (seat: ${roleLabel})`);
    }
  }
}

/** Subject fields prefilled into an edit dialog. */
export function editInitialValues(subject: ActionSubject): Record<string, string> {
  return {
    customerEmail: subject.customerEmail,
    customerFullName: subject.customerFullName ?? "",
    companyName: subject.companyName ?? "",
    paymentNoted: subject.paymentNoted ?? "",
  };
}

/* ------------------------------------------------------------------ host */

export function ActionHost({
  pending,
  onSettled,
  onCancel,
}: {
  pending: PendingAction | null;
  /** Called after success with the server's message, or after failure with one. */
  onSettled: (message: { kind: "success" | "error"; text: string }) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pending) return null;
  const spec = dialogFor(pending, "operator");
  if (!spec) return null;
  const withInitial: ConfirmSpec =
    pending.id === "edit"
      ? { ...spec, initialValues: editInitialValues(pending.subject) }
      : spec;

  async function run(input: ConfirmInput) {
    setBusy(true);
    setError(null);
    try {
      const text = await dispatch(pending!, input);
      setBusy(false);
      onSettled({ kind: "success", text });
    } catch (cause) {
      setBusy(false);
      /*
       * The server's sentence is kept verbatim. `search.ts` and the state
       * machine both explain *why* and *what instead* ("A licence in DRAFT is
       * not re-sendable. Only ISSUED and ACTIVE may be re-distributed"), and
       * replacing that with "action failed" would discard the only explanation
       * the operator has for why the row did not change.
       */
      const message =
        cause instanceof AdminHttpError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "The request failed.";
      setError(message);
      onSettled({ kind: "error", text: message });
    }
  }

  return (
    <ConfirmDialog
      // Keyed so switching straight from one row's dialog to another's (or
      // from Revoke to Suspend) resets the reason field rather than leaving
      // the previous row's text prefilled in a dialog about a new licence.
      key={`${pending.id}:${pending.subject.serialId}`}
      spec={{ ...withInitial, error: error ?? withInitial.error }}
      busy={busy}
      onCancel={() => {
        if (busy) return;
        setError(null);
        onCancel();
      }}
      onConfirm={(input) => void run(input)}
    />
  );
}

/** The request for one action. Separated so `dialogFor` stays pure. */
export async function dispatch(
  pending: PendingAction,
  input: ConfirmInput,
): Promise<string> {
  const { id, subject } = pending;
  const values = input.values;
  const reason = (values.reason ?? "").trim();

  switch (id) {
    case "confirmPayment":
      await adminClient.confirmPayment(
        subject.serialId,
        // Non-empty by construction: `ConfirmDialog` will not submit with a
        // required field blank, and the server re-checks it anyway. Trimmed
        // rather than coerced so a stray space cannot become a value the enum
        // rejects at the driver.
        (values.paymentMethod ?? "").trim(),
        (values.reference ?? "").trim() || undefined,
      );
      return "Payment confirmed.";
    case "approveIssue":
      // One request. The server provisions and issues inside a single
      // transaction, so there is no second call to sequence behind this one.
      await adminClient.issue(subject.serialId);
      return "Licence issued.";
    case "resend":
      await adminClient.resend(subject.serialId);
      return "Licence re-sent to the customer.";
    case "suspend":
      await adminClient.suspend(subject.serialId, reason);
      return "Licence suspended.";
    case "revoke":
      await adminClient.revoke(subject.serialId, reason);
      return "Licence revoked.";
    case "requestRebind":
      await adminClient.requestRebind(subject.serialId, reason);
      return "Rebind requested; awaiting approval.";
    case "edit":
      await adminClient.patchSerial(subject.serialId, {
        customerEmail: values.customerEmail,
        customerFullName: values.customerFullName ?? "",
        companyName: values.companyName ?? "",
        paymentNoted: values.paymentNoted ?? "",
      });
      return "Customer details saved.";
    default:
      throw new Error(`action ${String(id)} has no request`);
  }
}
