import type {
  ReportSession,
  ReportSummary,
} from "./api";

export function SignedInHome(props: {
  fullName?: string | null;
  email: string;
  companyName?: string | null;
  sessions: ReportSession[];
  reports: ReportSummary[];
  busy: boolean;
  onFreeze: (processingSessionId: string) => void;
  onOpen: (reportId: string) => void;
  onLogout: () => void;
}) {
  return (
    <div className="signed-in">
      <h2>You're signed in</h2>
      <p className="muted">Account</p>
      {props.fullName && <p className="email-pill">{props.fullName}</p>}
      <p className="email-pill">{props.email}</p>
      {props.companyName && <p className="muted small">{props.companyName}</p>}
      <p className="muted small">
        This is a separate mobile account (not your Windows Erase login).
      </p>

      <h3>Processing sessions</h3>
      <p className="muted small">
        Freeze Report 1 from evidence already uploaded for a session. A missing
        catalog test stays PARTIAL — we do not invent a grade.
      </p>
      {props.sessions.length === 0 ? (
        <p className="muted small">
          No sessions yet. Upload S1 evidence from the Android app (or the local
          ingest script) first.
        </p>
      ) : (
        <ul className="session-list">
          {props.sessions.map((session) => {
            const frozen = props.reports.find(
              (report) => report.processingSessionId === session.processingSessionId,
            );
            const label = [session.manufacturer, session.model]
              .filter(Boolean)
              .join(" ");
            return (
              <li key={session.processingSessionId}>
                <div>
                  <strong>{label || "Unnamed device"}</strong>
                  <div className="muted small">
                    {new Date(session.createdAt).toISOString()}
                  </div>
                </div>
                {frozen ? (
                  <button
                    type="button"
                    className="btn ghost compact"
                    onClick={() => props.onOpen(frozen.reportId)}
                  >
                    Open {frozen.publicNumber}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn compact"
                    disabled={props.busy}
                    onClick={() => props.onFreeze(session.processingSessionId)}
                  >
                    {props.busy ? "Freezing…" : "Freeze Report 1"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h3>Frozen reports</h3>
      {props.reports.length === 0 ? (
        <p className="muted small">No frozen reports yet.</p>
      ) : (
        <ul className="session-list">
          {props.reports.map((report) => (
            <li key={report.reportId}>
              <div>
                <strong>{report.publicNumber}</strong>
                <div className="muted small">
                  Coverage {report.coverage} · {report.frozenAt}
                </div>
              </div>
              <button
                type="button"
                className="btn ghost compact"
                onClick={() => props.onOpen(report.reportId)}
              >
                View
              </button>
            </li>
          ))}
        </ul>
      )}

      <button className="btn ghost" onClick={props.onLogout}>
        Sign out
      </button>
    </div>
  );
}
