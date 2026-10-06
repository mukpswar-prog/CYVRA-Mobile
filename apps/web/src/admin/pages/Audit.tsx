/**
 * THE AUDIT PAGE - §45's trail, and the page §41 marks LIMITED.
 * =============================================================
 *
 * `GET /admin/audit` is gated on `audit:read`, which all four roles hold, and
 * then *scoped* server-side: for an OPERATOR the query builder ANDs its own
 * `actor_id` in, regardless of what the request asked for. The console cannot
 * widen that, and does not try to - what it does instead is render the
 * response's `scope` field as a sentence.
 *
 * WHY THE SCOPE IS A SENTENCE
 * ---------------------------
 * An operator who sees three rows will, correctly, assume the log is broken.
 * `scope: "self"` turns "where is the rest of my audit log?" into "you are
 * seeing your own activity" - an answer rather than a support ticket. The
 * banner is amber and explicit, and it is driven by the SERVER's field rather
 * than by a client-side guess about which role is limited: if the two ever
 * disagreed, the server's answer wins, because the server is the one that
 * actually narrowed the query.
 *
 * THE PAGER IS THE SERVER'S, EXACTLY AS IN THE REGISTRY. `returned` and
 * `total` are rendered as received; nothing is derived from `events.length`
 * except as a cross-check that renders a warning rather than a correction.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AdminHttpError,
  adminClient,
  buildAuditQuery,
  EMPTY_AUDIT_QUERY,
  type AuditQueryState,
} from "../client";
import { EmptyState, Notice, Spinner } from "../components/kit";
import { MultiSelect, type ChoiceOption } from "../components/MultiSelect";
import { Pager } from "../components/Pager";
import { formatDateTime } from "../format/datetime";
import { LOADING_PAGINATION } from "../pagination";
import type { AuditListResponse, Pagination } from "../types";

/**
 * The `audit_action_enum` vocabulary, transcribed from `schema.ts`.
 *
 * Mirrored rather than discovered: the server refuses an unknown token with a
 * 400 that lists every legal value, so offering an option that is not here
 * would be a control whose failure mode is a red banner.
 */
export const AUDIT_ACTIONS: readonly string[] = Object.freeze([
  "SERIAL_CREATED",
  "SERIAL_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_UPDATED",
  "KEY_GENERATED",
  "LICENCE_APPROVED",
  "LICENCE_ISSUED",
  "LICENCE_RESENT",
  "LICENCE_SUSPENDED",
  "LICENCE_REVOKED",
  "REBIND_REQUESTED",
  "REBIND_APPROVED",
  "HOST_LOCKED",
  "EXPORT_GENERATED",
  "STAFF_INVITED",
  "STAFF_ROLE_CHANGED",
  "STAFF_SUSPENDED",
  "STAFF_REVOKED",
]);

const ACTION_OPTIONS: readonly ChoiceOption[] = AUDIT_ACTIONS.map((value) => ({
  value,
  label: value.replace(/_/g, " ").toLowerCase(),
}));

function dayInstant(date: string, end: boolean): string {
  if (date === "") return "";
  return `${date}T${end ? "23:59:59.999" : "00:00:00.000"}Z`;
}

type Flash = { kind: "info" | "error"; text: string };

export function AuditPage({
  entityId,
  onClearEntity,
}: {
  /** Set by the row menu's "View Audit" so the trail can be pre-scoped. */
  entityId?: string;
  onClearEntity?: () => void;
}) {
  const [state, setState] = useState<AuditQueryState>(() => ({
    ...EMPTY_AUDIT_QUERY,
    entityId: entityId ?? "",
  }));
  const [dayFrom, setDayFrom] = useState("");
  const [dayTo, setDayTo] = useState("");
  const [response, setResponse] = useState<AuditListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [flash, setFlash] = useState<Flash | null>(null);

  const serialised = buildAuditQuery({
    ...state,
    from: dayInstant(dayFrom, false),
    to: dayInstant(dayTo, true),
  });

  const patch = useCallback((next: Partial<AuditQueryState>) => {
    setState((current) => {
      const merged = { ...current, ...next };
      const paging = Object.keys(next).length === 1 && next.page !== undefined;
      if (!paging) merged.page = 1;
      return merged;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminClient
      .listAudit(serialised)
      .then((next) => {
        if (cancelled) return;
        setResponse(next);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setResponse(null);
        setError(cause instanceof AdminHttpError ? cause.message : "Could not read the audit trail.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serialised, nonce]);

  const exportAll = useCallback(async () => {
    // Read-only route, so there is no file: the point is to put the *page's*
    // filters into the operator's clipboard-ready query string, so the same
    // view can be re-opened or shared. No `EXPORT_GENERATED` is written
    // because nothing is exported - and inventing one would corrupt the very
    // trail this page is showing.
    const url = `/admin/audit?${serialised}`;
    setFlash({ kind: "info", text: `Query for this view: ${url}` });
  }, [serialised]);

  const events = response?.events ?? [];
  const pagination: Pagination = response?.pagination ?? LOADING_PAGINATION;
  const scopeSelf = response?.scope === "self";

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

      {scopeSelf ? (
        <Notice kind="warn">
          <strong>Your seat is LIMITED.</strong> The server returns only events you performed
          yourself - this page cannot widen that, and does not attempt to. A SUPER_ADMIN,
          LICENCE_ADMIN or AUDITOR sees the whole trail for the same query.
        </Notice>
      ) : null}

      <section className="card">
        <div className="card__head">
          <div className="row row--wrap" style={{ justifyContent: "space-between" }}>
            <div>
              <h2 className="card__title">Audit trail</h2>
              <p className="card__hint">
                Every write the admin API has performed, newest first. Filters are applied by the
                server; nothing is filtered in the browser.
              </p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn--sm" onClick={() => setNonce((n) => n + 1)}>
                Refresh
              </button>
              <button type="button" className="btn btn--sm" onClick={() => void exportAll()}>
                Show query
              </button>
            </div>
          </div>
        </div>

        <div className="toolbar">
          <MultiSelect
            label="Action"
            placeholder="Action"
            options={ACTION_OPTIONS}
            selected={state.action}
            onChange={(value) => patch({ action: value })}
          />
          <label className="field" style={{ marginBottom: 0, width: 200 }}>
            <span className="field__label">Actor</span>
            <input
              className="input"
              type="email"
              placeholder="someone@cyvoriq.com"
              value={state.actor}
              onChange={(event) => patch({ actor: event.target.value })}
            />
          </label>
          <label className="field" style={{ marginBottom: 0, width: 170 }}>
            <span className="field__label">From</span>
            <input
              className="input"
              type="date"
              value={dayFrom}
              max={dayTo || undefined}
              onChange={(event) => setDayFrom(event.target.value)}
            />
          </label>
          <label className="field" style={{ marginBottom: 0, width: 170 }}>
            <span className="field__label">To</span>
            <input
              className="input"
              type="date"
              value={dayTo}
              min={dayFrom || undefined}
              onChange={(event) => setDayTo(event.target.value)}
            />
          </label>
          {state.entityId !== "" ? (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                patch({ entityId: "" });
                onClearEntity?.();
              }}
            >
              Clear licence scope
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              setState({ ...EMPTY_AUDIT_QUERY, entityId: "" });
              setDayFrom("");
              setDayTo("");
            }}
          >
            Reset
          </button>
        </div>

        {state.entityId !== "" ? (
          <div style={{ padding: "12px 18px 0" }}>
            <Notice kind="info">
              Scoped to one licence: <code>{state.entityId}</code>
            </Notice>
          </div>
        ) : null}

        {error ? (
          <div style={{ padding: 18 }}>
            <Notice kind="error">
              {error}{" "}
              <button type="button" className="btn btn--sm" onClick={() => setNonce((n) => n + 1)}>
                Retry
              </button>
            </Notice>
          </div>
        ) : null}

        {loading && response === null && !error ? (
          <div style={{ padding: 18 }}>
            <Spinner label="Reading the trail…" />
          </div>
        ) : null}

        {response !== null && events.length === 0 && !loading ? (
          <EmptyState
            title="No events match these filters."
            hint="The pager below still reports the server's totals for this query."
          />
        ) : null}

        {events.length > 0 ? (
          <div className="card__body">
            <ol className="timeline">
              {events.map((event) => (
                <li className="timeline__item" key={event.id}>
                  <div className="timeline__action">{event.action.replace(/_/g, " ")}</div>
                  <div className="timeline__meta">
                    {formatDateTime(event.createdAt)}
                    {event.actorEmail ? ` · ${event.actorEmail}` : ""}
                    {event.actorRole ? ` · ${event.actorRole}` : ""}
                    {` · ${event.entityType}`}
                    {event.entityId ? ` · ${event.entityId}` : ""}
                  </div>
                  {event.previousState || event.newState ? (
                    <div className="timeline__reason">
                      {describeChange(event.previousState, event.newState)}
                    </div>
                  ) : null}
                  {event.reason ? <div className="timeline__reason">{event.reason}</div> : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <Pager
          pagination={pagination}
          onPageChange={(page) => patch({ page })}
          onPageSizeChange={(pageSize) => patch({ pageSize })}
          noun="events"
          busy={loading && response === null}
        />
      </section>
    </div>
  );
}

/**
 * A readable diff of two JSON snapshots.
 *
 * Key-by-key rather than a JSON dump: `previousState` / `newState` are small
 * objects written by the routes, and printing them raw would bury the one
 * changed field under five unchanged ones.
 */
function describeChange(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const keys = [...new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})])];
  const changes = keys
    .map((key) => {
      const before = previous?.[key];
      const after = next?.[key];
      if (JSON.stringify(before) === JSON.stringify(after)) return null;
      return `${key}: ${stringify(before)} → ${stringify(after)}`;
    })
    .filter((line): line is string => line !== null);
  return changes.length > 0 ? changes.join(" · ") : "No field-level change recorded.";
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
