/**
 * THE LICENCE DRAWER - §44's record view and §63's issuance stepper.
 * ==================================================================
 *
 * Layout: Customer / Licence / Payment / Host Binding / Communication / Audit
 * Timeline, in that order - the order a person actually asks questions in
 * ("who is this", "what did they buy", "did they pay", "where does it run",
 * "did it reach them", "what has happened to it").
 *
 * TWO THINGS WORTH DEFENDING
 * --------------------------
 *
 * 1. THE FULL KEY IS NOT HERE UNTIL IT IS ASKED FOR.
 *    `GET /admin/serials/:id` is the only route that returns `publicNumber`
 *    unmasked, so the payload already contains it. The drawer nevertheless
 *    renders `beforeReveal(fullKey)` - the same mask the list would have sent -
 *    and shows the real value only after an explicit click. Data that happens
 *    to be in memory and data that is *displayed* are different exposures to a
 *    shoulder-surfer, a screen share and a screenshot, and the brief asks for
 *    the second one to be a deliberate act.
 *
 * 2. THE STEPPER'S GREEN IS PAID, NOT READY.
 *    `generateKeyIsReady` reads `paymentStatus === "PAID"` and nothing else.
 *    §63 says Generate Key is grey before payment and GREEN after it; keying
 *    the colour off `licence_status` would encode an implication where the spec
 *    states a fact. See `tone.ts`.
 *
 * The Audit Timeline is fetched separately (`GET /admin/audit?entityId=`) so a
 * failure to read it leaves the rest of the record usable - and so the seat's
 * own scoping (`scope: "self"`) is rendered as a sentence rather than as a
 * mysteriously short list.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AdminHttpError, adminClient } from "../client";
import { Badge, EmptyState, Notice, Spinner } from "../components/kit";
import {
  customerKindTone,
  expiryTone,
  generateKeyIsReady,
  hostBindingTone,
  licenceStatusTone,
  paymentTone,
} from "../components/tone";
import { beforeReveal } from "../key";
import { rowActions, type ActionableLicence, type RowActionId } from "../licences/actions";
import { dash, formatDateTime, formatDate } from "../licences/LicenceTable";
import type { StaffRole } from "../permissions";
import type { AuditEvent, LicenceRecord } from "../types";

/* ---------------------------------------------------------------- stepper */

const BEFORE_KEY = new Set(["DRAFT", "PAYMENT_PENDING", "PAYMENT_CONFIRMED", "READY_TO_GENERATE"]);
const KEY_DONE = new Set(["KEY_GENERATED"]);
const ISSUED = new Set(["ISSUED", "ACTIVE", "EXPIRED", "SUSPENDED", "REVOKED"]);

export interface StepState {
  readonly title: string;
  readonly hint: string;
  readonly status: "done" | "current" | "todo";
}

/**
 * §63's three steps, derived purely from state - no flags, no "which did the
 * user click". Two rows in the same state must render the same stepper, and a
 * stepper driven by click history would let two identical licences look
 * differently progressed.
 */
export function issuanceSteps(record: LicenceRecord): StepState[] {
  const paymentDone = !BEFORE_KEY.has(record.status);
  const keyDone = KEY_DONE.has(record.status) || ISSUED.has(record.status);
  const issueDone = ISSUED.has(record.status);

  const steps: { title: string; hint: string; done: boolean }[] = [
    {
      title: "Confirm Payment",
      hint: paymentDone
        ? `Payment recorded as ${record.paymentStatus ?? "no record"}.`
        : "Awaiting confirmation that the money arrived.",
      done: paymentDone,
    },
    {
      title: "Generate Key",
      hint: keyDone ? "A signed licence key exists." : "Creates the signed licence credential.",
      done: keyDone,
    },
    {
      title: "Approve & Issue",
      hint: issueDone ? `Issued${record.issuedAt ? ` ${formatDate(record.issuedAt)}` : ""}.` : "Releases the licence for activation.",
      done: issueDone,
    },
  ];

  // Exactly one step is "current": the first unfinished one. Derived, never
  // recorded - two rows in the same state must render the same stepper.
  let currentAssigned = false;
  return steps.map((step) => {
    let status: StepState["status"];
    if (step.done) {
      status = "done";
    } else if (currentAssigned) {
      status = "todo";
    } else {
      currentAssigned = true;
      status = "current";
    }
    return { title: step.title, hint: step.hint, status };
  });
}

/* ------------------------------------------------------------------ parts */

function Section({
  title,
  aside,
  id,
  children,
}: {
  title: string;
  aside?: ReactNode;
  /** Anchor for in-page navigation (the row menu's "View Audit"). */
  id?: string;
  children: ReactNode;
}) {
  return (
    <section className="section" id={id}>
      <div className="section__head">
        <span>{title}</span>
        {aside}
      </div>
      <div className="section__body">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/* ----------------------------------------------------------------- drawer */

export interface DrawerContext {
  role: StaffRole | null;
  isSuperAdmin: boolean;
}

export function LicenceDrawer({
  serialId,
  context,
  onClose,
  onAction,
}: {
  serialId: string;
  context: DrawerContext;
  onClose: () => void;
  onAction: (id: RowActionId, record: LicenceRecord) => void;
}) {
  const [record, setRecord] = useState<LicenceRecord | null>(null);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [scope, setScope] = useState<"all" | "self">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRevealed(false);

    // Two independent requests. The record failing must not blank the audit
    // trail (and vice versa), so each carries its own error rather than one
    // banner standing in for both.
    Promise.allSettled([
      adminClient.getSerial(serialId),
      adminClient.auditFor(serialId),
    ]).then(([serialResult, auditResult]) => {
      if (cancelled) return;
      if (serialResult.status === "fulfilled") {
        setRecord(serialResult.value.serial);
      } else {
        const cause = serialResult.reason;
        setError(
          cause instanceof AdminHttpError
            ? cause.message
            : "Could not load this licence record.",
        );
      }
      if (auditResult.status === "fulfilled") {
        setEvents(auditResult.value.events);
        setScope(auditResult.value.scope);
      } else {
        setEvents([]);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [serialId, nonce]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const decisions = useMemo(() => {
    if (!record) return null;
    const actionable: ActionableLicence = record;
    return rowActions(actionable, {
      role: context.role,
      isSuperAdmin: context.isSuperAdmin,
    });
  }, [record, context.role, context.isSuperAdmin]);

  return (
    <>
      <div className="drawer-scrim" role="presentation" onClick={onClose} />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={record ? `Licence ${record.customerEmail}` : "Licence record"}
      >
        <header className="drawer__head">
          <h2 className="drawer__title">
            Licence record
            {record ? <Badge view={licenceStatusTone(record.status)} /> : null}
            <button
              type="button"
              className="btn btn--sm"
              style={{ marginLeft: "auto" }}
              onClick={onClose}
            >
              Close
            </button>
          </h2>
          {record ? (
            <p className="card__hint" style={{ marginTop: 6, marginBottom: 0 }}>
              {record.customerEmail} · {record.planCode} · {record.deviceMax} devices
            </p>
          ) : null}
        </header>

        <div className="drawer__body">
          {loading ? <Spinner label="Loading the record…" /> : null}

          {error ? (
            <Notice kind="error">
              {error}{" "}
              <button type="button" className="btn btn--sm" onClick={reload}>
                Retry
              </button>
            </Notice>
          ) : null}

          {record ? (
            <>
              <IssuanceStepper record={record} paymentReady={generateKeyIsReady(record.paymentStatus)} />

              <Section
                title="Customer"
                aside={
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {record.customerKind === "BULK" ? "Bulk" : "Single"}
                  </span>
                }
              >
                <dl className="dl">
                  <Row label="Email">{record.customerEmail}</Row>
                  <Row label="Name">{record.customerFullName}</Row>
                  <Row label="Company">{record.companyName}</Row>
                  <Row label="Type">
                    <Badge view={customerKindTone(record.customerKind)} />
                  </Row>
                  <Row label="Address">
                    {record.addressLine1}
                    {record.addressLine2 ? <>, {record.addressLine2}</> : null}
                  </Row>
                  <Row label="PIN / State">
                    {record.pincode} {record.state}
                  </Row>
                </dl>
              </Section>

              <Section title="Licence">
                <dl className="dl">
                  <Row label="Licence ID"><span className="mono">{record.serialId}</span></Row>
                  <Row label="Plan">
                    {record.planCode} <span className="muted">· {record.slabLabel}</span>
                  </Row>
                  <Row label="Capacity">{record.deviceMax} devices</Row>
                  <Row label="Brand scope">{record.brandScope}</Row>
                  <Row label="Status">
                    <Badge view={licenceStatusTone(record.status)} />
                  </Row>
                  <Row label="Key">
                    <KeyReveal
                      fullKey={record.publicNumber ?? record.licenceKey}
                      revealed={revealed}
                      onToggle={() => setRevealed((value) => !value)}
                    />
                  </Row>
                  <Row label="Created">{formatDateTime(record.createdAt)}</Row>
                  <Row label="Issued">{formatDateTime(record.issuedAt)}</Row>
                  {/*
                   * DESIGN FREEZE §29 - THE TWO ACTORS, SIDE BY SIDE.
                   *
                   * `Issued by` used to render `record.issuedBy` bare. That was
                   * harmless while the column was NOT NULL and always held a
                   * name, and it started producing an empty `<dd>` the moment
                   * migration 0008 made the column nullable: "no issuer yet"
                   * and "field failed to load" looked identical. `dash()`
                   * restores the table's own answer to that ambiguity.
                   *
                   * `Created by` is new here and deliberately stays out of the
                   * table: §13/§65 fix that column set, while §29 asks the
                   * detail view to show who made the record, and §56 already
                   * gives the XLSX export its own Created By column. A record
                   * the software created on a customer's behalf therefore
                   * reads `registration@cyvoriq.co.in` here rather than
                   * appearing to have no author at all.
                   */}
                  <Row label="Created by">{dash(record.createdBy)}</Row>
                  <Row label="Issued by">{dash(record.issuedBy)}</Row>
                  <Row label="Expiry">
                    {expiryTone(record.validityEndsAt) ? (
                      <>
                        {formatDate(record.validityEndsAt)}{" "}
                        <Badge view={expiryTone(record.validityEndsAt) ?? { text: "—", tone: "neutral" }} />
                      </>
                    ) : (
                      "—"
                    )}
                  </Row>
                </dl>
              </Section>

              <Section title="Payment">
                <dl className="dl">
                  <Row label="Payment status">
                    <Badge view={paymentTone(record.paymentStatus)} />
                  </Row>
                  <Row label="Noted">{record.paymentNoted}</Row>
                </dl>
                {record.paymentStatus === null ? (
                  <p className="field__help">
                    No payment row exists for this licence. That is not the same as Pending -
                    it means no payment record was written, and Pending would be a claim about
                    money nobody made.
                  </p>
                ) : null}
              </Section>

              <Section title="Host Binding">
                <dl className="dl">
                  <Row label="Binding status">
                    <Badge view={hostBindingTone(record.hostBindingStatus)} />
                  </Row>
                  <Row label="Devices bound">{record.devicesBound} of {record.deviceMax}</Row>
                  <Row label="Activated">{formatDateTime(record.firstActivatedAt)}</Row>
                  <Row label="User ID">{record.userId}</Row>
                </dl>
              </Section>

              <Section title="Communication">
                <dl className="dl">
                  <Row label="Emailed">{formatDateTime(record.emailedAt)}</Row>
                  <Row label="Message ID">{record.emailMessageId}</Row>
                  <Row label="Delivery error">
                    {record.emailError ? (
                      <Badge view={{ text: "Failed", tone: "red" }} />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </Row>
                </dl>
                {record.emailError ? <p className="field__error">{record.emailError}</p> : null}
              </Section>

              <Section
                id="licence-audit"
                title="Audit Timeline"
                aside={
                  scope === "self" ? (
                    <span className="badge badge--amber" title="Your seat is LIMITED">
                      Showing only your own actions
                    </span>
                  ) : null
                }
              >
                {events === null ? (
                  <Spinner label="Reading the trail…" />
                ) : events.length === 0 ? (
                  <EmptyState
                    title="No events recorded yet."
                    hint="Nothing has happened to this licence since it was created."
                  />
                ) : (
                  <ol className="timeline">
                    {events.map((event) => (
                      <li className="timeline__item" key={event.id}>
                        <div className="timeline__action">{event.action.replace(/_/g, " ")}</div>
                        <div className="timeline__meta">
                          {formatDateTime(event.createdAt)}
                          {event.actorEmail ? ` · ${event.actorEmail}` : ""}
                          {event.actorRole ? ` · ${event.actorRole}` : ""}
                        </div>
                        {event.reason ? (
                          <div className="timeline__reason">{event.reason}</div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
            </>
          ) : null}

          {!loading && !error && record === null ? (
            <EmptyState title="This licence could not be loaded." />
          ) : null}
        </div>

        {record && decisions ? (
          <footer className="drawer__foot">
            {(() => {
              const confirm = decisions.find((item) => item.id === "confirmPayment");
              const generate = decisions.find((item) => item.id === "generateKey");
              const issue = decisions.find((item) => item.id === "approveIssue");
              return (
                <>
                  {confirm?.enabled ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onAction("confirmPayment", record)}
                    >
                      Confirm Payment
                    </button>
                  ) : null}
                  {generate?.enabled ? (
                    <button
                      type="button"
                      className={generate.ready ? "btn btn--ready" : "btn"}
                      onClick={() => onAction("generateKey", record)}
                      title={generate.reason ?? undefined}
                    >
                      Generate Key
                    </button>
                  ) : null}
                  {issue?.enabled ? (
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => onAction("approveIssue", record)}
                    >
                      Approve &amp; Issue
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onAction("viewAudit", record)}
                    disabled={!(decisions.find((i) => i.id === "viewAudit")?.enabled ?? false)}
                  >
                    View Audit
                  </button>
                </>
              );
            })()}
          </footer>
        ) : null}
      </aside>
    </>
  );
}

/* -------------------------------------------------------------- stepper */

export function IssuanceStepper({
  record,
  paymentReady,
}: {
  record: LicenceRecord;
  paymentReady: boolean;
}) {
  const steps = issuanceSteps(record);
  return (
    <section className="section">
      <div className="section__head">
        <span>Issuance</span>
        <span className="muted" style={{ fontWeight: 400, textTransform: "none" }}>
          {paymentReady ? "Payment received" : "Payment not yet received"}
        </span>
      </div>
      <div className="section__body">
        <ol className="stepper">
          {steps.map((step, index) => (
            <li
              className={`step ${step.status === "done" ? "step--done" : step.status === "current" ? "step--current" : ""}`}
              key={step.title}
            >
              <span className="step__dot" aria-hidden="true">
                {step.status === "done" ? "✓" : index + 1}
              </span>
              <span>
                <span className="step__title">
                  {step.title}
                  <span className="visually-hidden">{` - ${step.status}`}</span>
                </span>
                <span className="step__hint">{step.hint}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- key cell */

/**
 * Masked until asked for.
 *
 * The toggle is a button rather than a `<details>`: a `<summary>` whose content
 * is already in the DOM would be equally visible to a screen reader before it
 * is opened, and the whole point of the reveal is that it is an act.
 */
export function KeyReveal({
  fullKey,
  revealed,
  onToggle,
}: {
  fullKey: string | null;
  revealed: boolean;
  onToggle: () => void;
}) {
  if (fullKey === null || fullKey === "") {
    return <span className="muted">No key generated yet</span>;
  }
  return (
    <span className="row row--wrap" style={{ gap: 6 }}>
      <span className="cell-key">{revealed ? fullKey : beforeReveal(fullKey)}</span>
      <button type="button" className="btn btn--sm" onClick={onToggle}>
        {revealed ? "Hide key" : "Reveal full key"}
      </button>
    </span>
  );
}
