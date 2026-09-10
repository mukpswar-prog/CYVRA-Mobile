import { useMemo } from "react";
import type { ReportDetail, ReportEntry } from "./api";

const DOMAIN_ORDER = [
  "IDENTITY_CONFIGURATION",
  "PHYSICAL_CONDITION",
  "HARDWARE_CONFIGURATION",
  "FUNCTIONAL_VERIFICATION",
  "CONNECTIVITY",
  "POWER_BATTERY_STORAGE",
  "SECURITY_ACCESS_LIMITATIONS",
];

function groupByDomain(entries: ReportEntry[]) {
  const groups = new Map<string, { label: string; entries: ReportEntry[] }>();
  for (const entry of entries) {
    const existing = groups.get(entry.domain);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(entry.domain, {
        label: entry.domainLabel || entry.domain,
        entries: [entry],
      });
    }
  }
  return DOMAIN_ORDER.flatMap((domain) => {
    const group = groups.get(domain);
    return group ? [{ domain, ...group }] : [];
  }).concat(
    [...groups.entries()]
      .filter(([domain]) => !DOMAIN_ORDER.includes(domain))
      .map(([domain, group]) => ({ domain, ...group })),
  );
}

export function ReportView(props: {
  report: ReportDetail;
  onBack: () => void;
}) {
  const groups = useMemo(() => groupByDomain(props.report.entries), [props.report.entries]);

  return (
    <article className="report-sheet">
      <div className="report-toolbar no-print">
        <button type="button" className="btn ghost" onClick={props.onBack}>
          Back to account
        </button>
        <button type="button" className="btn" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <header className="report-header">
        <p className="report-kicker">CYVRA Mobile Evidence</p>
        <h1>{props.report.title}</h1>
        <p className="report-number">{props.report.publicNumber}</p>
        <p className="muted small">
          Frozen {new Date(props.report.frozenAt).toISOString()} · Coverage{" "}
          <strong>{props.report.coverage}</strong>
        </p>
        <p className="coverage-caption">{props.report.coverageCaption}</p>
        <p className="muted small">
          This is a view of a frozen evidence manifest. Neon evidence is the
          source of truth. PDF is not a separate certificate.
        </p>
      </header>

      {groups.length === 0 ? (
        <p className="muted">No catalog entries were frozen for this session.</p>
      ) : (
        groups.map((group) => (
          <section key={group.domain} className="report-domain">
            <h2>{group.label}</h2>
            <table>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Objective</th>
                  <th>Result</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {group.entries.map((entry) => (
                  <tr key={entry.evidenceId}>
                    <td>
                      <strong>{entry.userName}</strong>
                      <div className="muted small">{entry.testId}</div>
                    </td>
                    <td>{entry.objectiveName}</td>
                    <td>
                      <span className={`result-pill result-${entry.result.toLowerCase()}`}>
                        {entry.result.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="muted small">{entry.source.replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}

      <footer className="report-nongoals">
        <h2>What this report is not</h2>
        <ul>
          {props.report.nongoals.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </footer>
    </article>
  );
}
