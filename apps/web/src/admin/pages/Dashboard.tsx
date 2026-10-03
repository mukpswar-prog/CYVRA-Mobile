/**
 * THE DASHBOARD - §65's home page: the strip, plus Needs Action.
 *
 * Every number here is `pagination.total` from a count-only request. The page
 * fetches NO licence rows at all: there is no `useState` holding a list, so
 * there is nowhere a summed accumulator could accidentally live. A dashboard
 * that had fetched pages and counted them would render a plausible, wrong
 * number the first time a page failed - and a plausible wrong number on a
 * "Payment Pending" card tells somebody that nothing needs doing.
 *
 * `useServerTotals` fires one request per distinct query, in parallel, and
 * deduplicates the overlap between the strip and the queue (both show "Payment
 * pending" and "Ready to generate"). That is 8 requests for 10 figures, not 10.
 */
import { useCallback, useMemo } from "react";
import type { SerialQueryState } from "../client";
import { Notice, Spinner } from "../components/kit";
import { KpiStrip, NeedsAction } from "../licences/Kpis";
import { KPIS, QUEUE, useServerTotals } from "../licences/totals";
import { useSessionState } from "../shell/session";

const ALL_TOTALS = [...KPIS, ...QUEUE];

export function DashboardPage({
  onGoToLicences,
}: {
  /** A KPI or queue click lands in the registry with that filter applied. */
  onGoToLicences: (patch: Partial<SerialQueryState>) => void;
}) {
  const { session, status } = useSessionState();
  const totals = useServerTotals(ALL_TOTALS);

  const select = useCallback(
    (patch: Partial<SerialQueryState>) => onGoToLicences(patch),
    [onGoToLicences],
  );

  const greeting = useMemo(() => {
    const role = session?.role;
    if (!role) return "Signed in without a role.";
    return `Welcome back, ${session?.email ?? ""} — you are signed in as ${role.replace("_", " ").toLowerCase()}.`;
  }, [session]);

  if (status === "loading") {
    return (
      <div className="card">
        <div className="card__body">
          <Spinner label="Reading your role from GET /admin/me…" />
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card__body">
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{greeting}</p>
          <p className="card__hint" style={{ marginTop: 4, marginBottom: 0 }}>
            Each figure below is the server&apos;s <code>pagination.total</code> for one filtered
            count request. None of them is added up in the browser.
          </p>
        </div>
      </div>

      <KpiStrip totals={totals} loading={totals.loading} onSelect={select} activePatch={null} />

      <div className="row row--wrap" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: "2 1 340px" }}>
          <NeedsAction totals={totals} loading={totals.loading} onSelect={select} />
        </div>

        <div style={{ flex: "1 1 260px" }} className="stack">
          {totals.error ? <Notice kind="warn">{totals.error}</Notice> : null}

          <section className="card">
            <div className="card__head">
              <h2 className="card__title">Where to start</h2>
            </div>
            <div className="card__body">
              <p className="card__hint" style={{ marginTop: 0 }}>
                The queue beside this lists five separate figures rather than one
                &quot;needs action&quot; total. Failed delivery lives in{" "}
                <code>email_error</code> and a rebind in <code>host_binding</code>, while the
                other three are <code>licence_status</code> values - a single request cannot
                ask for all five, and adding separate totals would double-count a licence that
                is awaiting approval <em>and</em> awaiting a rebind.
              </p>
              <p className="card__hint">
                Selecting a queue row opens the registry already filtered to it, so the number
                you clicked and the rows you land on are produced by the same query.
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <h2 className="card__title">Your seat</h2>
            </div>
            <div className="card__body">
              <dl className="dl">
                <dt>Email</dt>
                <dd>{session?.email ?? "—"}</dd>
                <dt>Role</dt>
                <dd>{session?.role ?? "No role attached"}</dd>
                <dt>Super Admin</dt>
                <dd>{session?.isSuperAdmin ? "Yes" : "No"}</dd>
              </dl>
              <p className="field__help">
                Permissions are derived from §41&apos;s matrix on the client and enforced
                independently by <code>requirePermission</code> on every route. The server does
                not read this page.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
