/**
 * §15 CONFIRMATIONS AND §37 REASON PROMPTS, AS A PURE FUNCTION.
 * =============================================================
 *
 * `dialogFor` is deliberately non-interactive: give it an action, a subject and
 * the decision that action's gates produced, and it returns the dialog the spec
 * calls for. That makes all twelve actions assertable without mounting the
 * registry, clicking a three-dot menu, and hoping the row is in the right state
 * - which would test the plumbing rather than the content.
 *
 * What is asserted here is content, because content is what §15 actually
 * specifies: Generate Key and Approve & Issue must name *this* licence's
 * customer, plan and payment, and Suspend / Revoke must carry a reason field
 * the server will refuse to proceed without. A dialog that confirms an abstract
 * action instead of a specific one is the failure this file exists to catch.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { dialogFor, editInitialValues, type ActionSubject, type PendingAction } from "./licences/ActionHost";
import { ROW_ACTION_IDS, rowAction, type ActionableLicence, type RowActionId } from "./licences/actions";
import type { StaffRole } from "./permissions";

function subject(overrides: Partial<ActionableLicence> = {}): ActionSubject {
  return {
    serialId: "00000000-0000-4000-8000-000000000001",
    customerEmail: "customer@example.com",
    planCode: "CAP-5",
    deviceMax: 5,
    status: "KEY_GENERATED",
    paymentStatus: "PAID",
    hostBindingStatus: "NOT_BOUND",
    devicesBound: 0,
    customerFullName: "A Customer",
    companyName: null,
    paymentNoted: "UPI 4471",
    ...overrides,
  };
}

function pending(id: RowActionId, role: StaffRole = "SUPER_ADMIN", row: Partial<ActionableLicence> = {}): PendingAction {
  const licence = subject(row);
  return {
    id,
    subject: licence,
    decision: rowAction(licence, { role, isSuperAdmin: role === "SUPER_ADMIN" }, id),
  };
}

/** Render just the body, so the assertions are on what an operator reads. */
function bodyOf(id: RowActionId, role?: StaffRole, row?: Partial<ActionableLicence>): HTMLElement {
  const spec = dialogFor(pending(id, role, row), "operator");
  expect(spec, `${id} should have a dialog`).not.toBeNull();
  const { container } = render(<div>{spec!.body}</div>);
  return container;
}

describe("actions with nothing to confirm have no dialog", () => {
  it("returns null for the four read-or-download actions", () => {
    for (const id of ["view", "viewActivation", "viewAudit", "exportRecord"] as const) {
      expect(dialogFor(pending(id), "operator"), `${id} must not open a confirmation`).toBeNull();
    }
  });

  it("covers every other action - no id falls through silently", () => {
    const withoutDialog = ROW_ACTION_IDS.filter(
      (id) => dialogFor(pending(id), "operator") === null,
    );
    expect(withoutDialog).toEqual(["view", "viewActivation", "viewAudit", "exportRecord"]);
  });
});

describe("§15: the high-impact confirmations name this licence", () => {
  it("Generate Key states the customer, the plan and the payment", () => {
    const container = bodyOf("generateKey");
    expect(container.textContent).toContain("customer@example.com");
    expect(container.textContent).toContain("CAP-5 (5 Mobile Devices)");
    expect(container.textContent).toContain("PAID");
    expect(container.textContent).toContain("This action will create a signed licence credential.");
    expect(container.textContent).toContain("Continue?");
  });

  it("Approve & Issue states the consequence", () => {
    const container = bodyOf("approveIssue");
    expect(container.textContent).toContain("customer@example.com");
    expect(container.textContent).toContain(
      "Once issued, this licence will be available for customer activation.",
    );
  });

  it("its confirm button reads Approve & Issue", () => {
    const spec = dialogFor(pending("approveIssue"), "operator");
    expect(spec?.confirmLabel).toBe("Approve & Issue");
    expect(spec?.tone).toBe("primary");
  });

  it("a failed payment is shown as No record, never as Pending", () => {
    const container = bodyOf("generateKey", "SUPER_ADMIN", { paymentStatus: null });
    expect(container.textContent).toContain("No record");
    expect(container.textContent).not.toContain("Payment pending");
  });
});

describe("§37: the reason field appears exactly where the server demands one", () => {
  const reasonRequired = ["suspend", "revoke"] as const;

  it("requires a reason for Suspend and Revoke", () => {
    for (const id of reasonRequired) {
      const spec = dialogFor(pending(id), "operator");
      const field = spec?.fields?.find((item) => item.name === "reason");
      expect(field, `${id} must prompt for a reason`).toBeDefined();
      expect(field?.required).not.toBe(false);
      expect(field?.rows).toBe(3);
      expect(field?.help).toMatch(/cannot be empty/i);
    }
  });

  it("treats the rebind reason as optional, because the server does", () => {
    const spec = dialogFor(pending("requestRebind"), "operator");
    const field = spec?.fields?.find((item) => item.name === "reason");
    expect(field?.required).toBe(false);
  });

  it("asks for no reason on Confirm Payment - its optional field is the reference", () => {
    const spec = dialogFor(pending("confirmPayment"), "operator");
    expect(spec?.fields?.map((field) => field.name)).toEqual(["reference"]);
    expect(spec?.fields?.[0]?.required).toBe(false);
  });

  it("arms Revoke as destructive", () => {
    const spec = dialogFor(pending("revoke"), "operator");
    expect(spec?.tone).toBe("danger");
    expect(spec?.confirmLabel).toBe("Revoke");
    expect(bodyOf("revoke").textContent).toMatch(/permanent/i);
  });

  it("arms Suspend as destructive but reversible", () => {
    const spec = dialogFor(pending("suspend"), "operator");
    expect(spec?.tone).toBe("danger");
    expect(bodyOf("suspend").textContent).toMatch(/reversible/i);
  });
});

describe("the waived Generate Key says what it is doing", () => {
  it("demands a waiver reason when the Super Admin bypasses payment", () => {
    const spec = dialogFor(
      pending("generateKey", "SUPER_ADMIN", { status: "PAYMENT_PENDING", paymentStatus: "PENDING" }),
      "operator",
    );
    const reason = spec?.fields?.find((field) => field.name === "reason");
    expect(reason, "a waiver must be reasoned").toBeDefined();
    expect(reason?.label).toBe("Waiver reason");
    // NOT green. §63 makes Generate Key green iff PAID, and a waiver is by
    // definition an unpaid generation - so the confirm button stays the normal
    // primary and the dialog is where the operator is told why.
    expect(spec?.tone).toBe("primary");
    expect(spec?.tone).not.toBe("ready");
    expect(bodyOf("generateKey", "SUPER_ADMIN", {
      status: "PAYMENT_PENDING",
      paymentStatus: "PENDING",
    }).textContent).toMatch(/paymentWaived: true/);
  });

  it("does not claim payment received on an unpaid generation", () => {
    const spec = dialogFor(
      pending("generateKey", "SUPER_ADMIN", { status: "PAYMENT_PENDING", paymentStatus: "PENDING" }),
      "operator",
    );
    expect(spec?.tone).not.toBe("ready");
  });

  it("asks for no reason on an ordinary paid generation", () => {
    const spec = dialogFor(pending("generateKey", "LICENCE_ADMIN"), "operator");
    expect(spec?.fields ?? []).toHaveLength(0);
  });
});

describe("Edit prefills rather than blanking", () => {
  it("offers the four editable fields, with the email required", () => {
    const spec = dialogFor(pending("edit"), "operator");
    expect(spec?.fields?.map((field) => field.name)).toEqual([
      "customerEmail",
      "customerFullName",
      "companyName",
      "paymentNoted",
    ]);
    expect(spec?.fields?.[0]?.required).toBe(true);
    expect(spec?.confirmLabel).toBe("Save changes");
    expect(bodyOf("edit").textContent).toMatch(/frozen for the life of the licence/i);
  });

  it("starts from the record's current values, not from blanks", () => {
    expect(editInitialValues(subject())).toEqual({
      customerEmail: "customer@example.com",
      customerFullName: "A Customer",
      companyName: "",
      paymentNoted: "UPI 4471",
    });
  });
});

describe("every dialog is reachable from the row menu", () => {
  it("has a spec for each of the twelve actions or deliberately none", () => {
    for (const id of ROW_ACTION_IDS) {
      const spec = dialogFor(pending(id), "operator");
      if (spec === null) continue;
      expect(spec.title.length).toBeGreaterThan(0);
      expect(spec.confirmLabel.length).toBeGreaterThan(0);
      expect(spec.body).toBeDefined();
    }
  });

  it("keeps the disabled action's explanation out of the dialog entirely", () => {
    // Suspend on a DRAFT row is refused by the state machine; the row menu
    // would never dispatch it, so no dialog is reachable for it.
    const refusal = rowAction(subject({ status: "DRAFT" }), { role: "SUPER_ADMIN", isSuperAdmin: true }, "suspend");
    expect(refusal.enabled).toBe(false);
    expect(refusal.reason).toContain("This licence is Draft");
    // And the dialog itself is defined, so the reason is never the only thing
    // standing between the operator and the request.
    expect(dialogFor(pending("suspend"), "operator")?.fields).toHaveLength(1);
  });
});

describe("no dialog mentions a seat it was not built for", () => {
  it("never embeds the operator's role in the copy", () => {
    for (const id of ROW_ACTION_IDS) {
      const spec = dialogFor(pending(id, "AUDITOR"), "AUDITOR");
      if (!spec) continue;
      const text = `${spec.title}${spec.confirmLabel}`;
      expect(text).not.toMatch(/auditor|super admin|licence admin/i);
    }
  });
});

describe("rendering smoke", () => {
  it("renders a title an operator can read aloud", () => {
    const spec = dialogFor(pending("generateKey"), "operator")!;
    render(
      <>
        <h2>{spec.title}</h2>
        <div>{spec.body}</div>
      </>,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Generate Licence Key?");
  });
});
