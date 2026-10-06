/**
 * THE STAFF PAGE - §16/§17's roster, invite and lifecycle.
 * =========================================================
 *
 * §41 has no "View staff" row, only "Manage staff - Super Admin". The server
 * resolves that split the way this page mirrors it:
 *
 *   GET  /admin/staff          gated `serial:read`  -> the PAGE is visible to
 *                                                     all four roles
 *   POST /admin/staff          gated `staff:manage` -> INVITE / APPROVE /
 *   POST /admin/staff/:id/*    gated `staff:manage`    SUSPEND / REVOKE are
 *                                                     Super Admin only
 *
 * Gating the page itself on `staff:manage` would hide a screen the server
 * serves to four roles; hiding the mutations but showing the roster is exactly
 * the §41 reading, and `PermissionGate` is what enforces the second half.
 *
 * VERIFY IS NOT A BUTTON, AND THAT IS THE POINT.
 * `EMAIL_VERIFIED` is reached by the *recipient* proving the address during
 * sign-in (`POST /admin/auth/verify` with a code sent to them). There is no
 * admin route that can mark an address verified, and building one - or
 * pretending one exists by calling the admin's own OTP route against somebody
 * else's inbox - would let one operator assert that another person's mailbox
 * was proven. So the state is displayed, with the sentence explaining who
 * completes it and how, and the buttons are the transitions an admin really
 * does own: approve, suspend, revoke.
 *
 * Every refusal below is the server's own sentence. `approveRefusal` and
 * `suspendRefusal` in `admin.ts` already explain *why* and *what instead*;
 * paraphrasing them here would create a second wording for the same refusal
 * that could drift from the first.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AdminHttpError, adminClient } from "../client";
import { Badge, EmptyState, Notice, Spinner } from "../components/kit";
import { ConfirmDialog, type ConfirmSpec, type ConfirmInput } from "../components/Dialog";
import { staffStatusTone } from "../components/tone";
import { explainRoleRefusal, can } from "../permissions";
import { PermissionGate } from "../shell/PermissionGate";
import { useSessionState } from "../shell/session";
import { formatDateTime } from "../format/datetime";
import type { StaffMember, StaffRole, StaffStatus } from "../types";

/** Mirrors `STAFF_APPROVE_FROM` / `STAFF_SUSPEND_FROM` in `admin.ts`. */
export const APPROVE_FROM: readonly StaffStatus[] = ["EMAIL_VERIFIED", "SUSPENDED"];
export const SUSPEND_FROM: readonly StaffStatus[] = ["INVITED", "EMAIL_VERIFIED", "ACTIVE"];

const ROLE_OPTIONS: readonly { value: StaffRole; label: string }[] = [
  { value: "SUPER_ADMIN", label: "Super Admin — full control" },
  { value: "LICENCE_ADMIN", label: "Licence Admin — payments, keys, issue" },
  { value: "OPERATOR", label: "Operator — create and edit, no keys" },
  { value: "AUDITOR", label: "Auditor — read and export only" },
];

/**
 * `null` when the action is legal for this person right now, otherwise the
 * sentence to show. Mirrors `approveRefusal` / `suspendRefusal` verbatim.
 */
export function staffActionReason(
  id: "approve" | "suspend" | "revoke",
  member: StaffMember,
  role: StaffRole | null,
): string | null {
  // Permission first, state second - same order as `licences/actions.ts`, and
  // for the same reason: telling an operator "that account has not verified its
  // email yet" about an Approve button they could never press implies that
  // verifying the email would make it work.
  if (!can(role, "staff:manage")) return explainRoleRefusal(role, "staff:manage");

  switch (id) {
    case "approve":
      if (APPROVE_FROM.includes(member.status)) return null;
      if (member.status === "ACTIVE") return "Already active — there is nothing to approve.";
      if (member.status === "INVITED") {
        return "That account has not verified its email yet. They must complete sign-in before you can approve it.";
      }
      return "A revoked account cannot be re-approved. Nominate a new address instead.";
    case "suspend":
      if (SUSPEND_FROM.includes(member.status)) return null;
      if (member.status === "REVOKED") {
        return "That account has been revoked; revoked accounts are not suspended.";
      }
      return "That account is already suspended.";
    case "revoke":
      if (member.status !== "REVOKED") return null;
      return "That account is already revoked.";
  }
}

const REASON_FIELD = {
  name: "reason",
  label: "Reason",
  required: true,
  rows: 3,
  help: "Recorded against the audit row. It cannot be empty.",
} as const;

export function staffDialog(id: "approve" | "suspend" | "revoke", member: StaffMember): ConfirmSpec {
  const subject = (
    <div className="dl" style={{ marginBottom: 12 }}>
      <dt>Account</dt>
      <dd>{member.email}</dd>
      <dt>Role</dt>
      <dd>{member.role.replace("_", " ").toLowerCase()}</dd>
      <dt>Status</dt>
      <dd>{member.status.replace("_", " ").toLowerCase()}</dd>
    </div>
  );

  if (id === "approve") {
    return {
      title: "Approve Staff Account?",
      body: (
        <>
          {subject}
          <p>
            The account becomes <strong>Active</strong> immediately and can sign in with the
            role shown above.
          </p>
        </>
      ),
      confirmLabel: "Approve",
    };
  }
  if (id === "suspend") {
    return {
      title: "Suspend Staff Account?",
      body: (
        <>
          {subject}
          <p>
            Suspension is reversible: approving the account again restores it. The person
            cannot sign in while suspended.
          </p>
        </>
      ),
      confirmLabel: "Suspend",
      tone: "danger",
      fields: [REASON_FIELD],
    };
  }
  return {
    title: "Revoke Staff Account?",
    body: (
      <>
        {subject}
        <p className="notice notice--error">
          Revocation is permanent. The address cannot be re-invited; nominate a new one.
        </p>
      </>
    ),
    confirmLabel: "Revoke",
    tone: "danger",
    fields: [REASON_FIELD],
  };
}

/* ------------------------------------------------------------------- page */

type Flash = { kind: "info" | "error"; text: string };

export function StaffPage() {
  const { session } = useSessionState();
  const role = session?.role ?? null;

  const [members, setMembers] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [pending, setPending] = useState<{
    id: "approve" | "suspend" | "revoke";
    member: StaffMember;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<StaffRole>("OPERATOR");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    adminClient
      .listStaff()
      .then((response) => {
        if (cancelled) return;
        setMembers(response.operators);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setMembers(null);
        setError(cause instanceof AdminHttpError ? cause.message : "Could not load the roster.");
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  async function submitInvite(event: FormEvent) {
    event.preventDefault();
    setInviteError(null);
    setInviteBusy(true);
    try {
      await adminClient.inviteStaff(inviteEmail.trim(), inviteRole);
      setInviteBusy(false);
      setInviteEmail("");
      setFlash({ kind: "info", text: "Invitation created. The recipient must sign in to verify their address." });
      reload();
    } catch (cause) {
      setInviteBusy(false);
      setInviteError(cause instanceof AdminHttpError ? cause.message : "Could not create the invitation.");
    }
  }

  async function runPending(input: ConfirmInput) {
    if (!pending) return;
    setBusy(true);
    setDialogError(null);
    const reason = (input.values.reason ?? "").trim();
    try {
      if (pending.id === "approve") await adminClient.approveStaff(pending.member.staffId);
      if (pending.id === "suspend") await adminClient.suspendStaff(pending.member.staffId, reason);
      if (pending.id === "revoke") await adminClient.revokeStaff(pending.member.staffId, reason);
      setBusy(false);
      setPending(null);
      setFlash({
        kind: "info",
        text:
          pending.id === "approve"
            ? "Account approved and active."
            : pending.id === "suspend"
              ? "Account suspended."
              : "Account revoked.",
      });
      reload();
    } catch (cause) {
      setBusy(false);
      const message =
        cause instanceof AdminHttpError ? cause.message : "The request failed.";
      setDialogError(message);
      setFlash({ kind: "error", text: message });
    }
  }

  return (
    <div className="stack">
      {flash ? (
        <Notice kind={flash.kind}>
          <span>{flash.text}</span>{" "}
          <button type="button" className="btn btn--sm" onClick={() => setFlash(null)}>
            Dismiss
          </button>
        </Notice>
      ) : null}

      <PermissionGate
        permission="staff:manage"
        role={role}
        fallback={
          <Notice kind="info">
            You can view the roster. Creating, approving, suspending and revoking accounts is
            Super Admin only (§41: <strong>Manage staff</strong>).
          </Notice>
        }
      >
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Invite a staff account</h2>
            <p className="card__hint">
              The address must be a <code>@cyvoriq.com</code> mailbox other than the Super
              Admin&apos;s. Choosing a role grants exactly the permissions in §41&apos;s matrix -
              nothing more.
            </p>
          </div>
          <form className="card__body" onSubmit={(event) => void submitInvite(event)}>
            <div className="row row--wrap" style={{ alignItems: "flex-start" }}>
              <label className="field" style={{ flex: "1 1 240px", marginBottom: 0 }}>
                <span className="field__label">Email address *</span>
                <input
                  className="input"
                  type="email"
                  required
                  placeholder="name@cyvoriq.com"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
              </label>
              <label className="field" style={{ flex: "1 1 240px", marginBottom: 0 }}>
                <span className="field__label">Role *</span>
                <select
                  className="select"
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as StaffRole)}
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={inviteBusy || inviteEmail.trim() === ""}
              >
                {inviteBusy ? "Inviting…" : "Send invitation"}
              </button>
            </div>
            {inviteError ? <p className="field__error">{inviteError}</p> : null}
          </form>
        </section>
      </PermissionGate>

      <section className="card">
        <div className="card__head">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2 className="card__title">Roster</h2>
              <p className="card__hint">
                Status is the account&apos;s standing. <strong>Email verified</strong> means the
                address was proven during sign-in and the account is waiting for approval.
              </p>
            </div>
            <button type="button" className="btn btn--sm" onClick={reload}>
              Refresh
            </button>
          </div>
        </div>

        {error ? (
          <div style={{ padding: 18 }}>
            <Notice kind="error">
              {error}{" "}
              <button type="button" className="btn btn--sm" onClick={reload}>
                Retry
              </button>
            </Notice>
          </div>
        ) : null}

        {members === null && !error ? (
          <div style={{ padding: 18 }}>
            <Spinner label="Loading the roster…" />
          </div>
        ) : null}

        {members !== null && members.length === 0 ? (
          <EmptyState title="No staff accounts yet." hint="Invite the first one above." />
        ) : null}

        {members && members.length > 0 ? (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Nominated by</th>
                  <th scope="col">Nominated</th>
                  <th scope="col">Revoked</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.staffId}>
                    <td>{member.email}</td>
                    <td>{member.role.replace("_", " ").toLowerCase()}</td>
                    <td>
                      <Badge view={staffStatusTone(member.status)} />
                    </td>
                    <td>{member.nominatedBy}</td>
                    <td className="nowrap">{formatDateTime(member.nominatedAt)}</td>
                    <td className="nowrap">{formatDateTime(member.revokedAt)}</td>
                    <td>
                      <div className="row row--wrap" style={{ gap: 6 }}>
                        {(["approve", "suspend", "revoke"] as const).map((id) => {
                          const reason = staffActionReason(id, member, role);
                          return (
                            <button
                              key={id}
                              type="button"
                              className={`btn btn--sm${id === "revoke" ? " btn--danger" : ""}`}
                              disabled={reason !== null}
                              title={reason ?? undefined}
                              onClick={() => {
                                setDialogError(null);
                                setPending({ id, member });
                              }}
                            >
                              {id === "approve" ? "Approve" : id === "suspend" ? "Suspend" : "Revoke"}
                              {reason ? <span className="visually-hidden"> — {reason}</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {pending ? (
        <ConfirmDialog
          key={`${pending.id}:${pending.member.staffId}`}
          spec={{ ...staffDialog(pending.id, pending.member), error: dialogError }}
          busy={busy}
          onCancel={() => {
            if (busy) return;
            setDialogError(null);
            setPending(null);
          }}
          onConfirm={(input) => void runPending(input)}
        />
      ) : null}
    </div>
  );
}
