/**
 * THE REPORTS PAGE - §57 / §60's export console.
 * ===============================================
 *
 * THREE RULES THIS PAGE KEEPS
 *
 * 1. Every export button starts at the SERVER route.
 *    `GET /admin/reports/licences?…&format=csv` writes `EXPORT_GENERATED`
 *    before it writes bytes. A file assembled in the browser writes nothing,
 *    and an export that leaves no trail is exactly what §53 exists to prevent.
 *    Both the `.csv` and the `.xlsx` buttons issue that one request; the second
 *    merely re-wraps the bytes it gets back.
 *
 * 2. The XLSX is a container change, not a second query.
 *    See `xlsx.ts`. It never filters, sorts or subsets, so the two files can
 *    not disagree - and if they ever did, the CSV is the audited artefact.
 *
 * 3. Display narrowing never touches the export.
 *    This route accepts only `from` and `to`. There is no status or payment
 *    filter on it, so a filter box here could only ever be a convenience over
 *    rows already fetched. It is labelled as such and the export button says
 *    plainly that it carries the whole range - a narrowing control that
 *    silently narrowed an audited file would be worse than no control at all.
 *
 * The metadata block (actor, range, row count) is rendered from the JSON
 * preview response, which is what the operator is looking at while they decide
 * what to download.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AdminHttpError, adminClient } from "../client";
import { Badge, EmptyState, Notice, Spinner } from "../components/kit";
import { formatDateTime } from "../licences/LicenceTable";
import { downloadBlob, csvToXlsx } from "../xlsx";
import type { ReportResponse, ReportRow } from "../types";

/** Local `YYYY-MM-DD`, which is what `<input type="date">` speaks. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from: isoDay(from), to: isoDay(to) };
}

type Flash = { kind: "info" | "error"; text: string };

export function ReportsPage() {
  const initial = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);
  const [nonce, setNonce] = useState(0);

  // Display-only narrowing over the preview.
  const [narrow, setNarrow] = useState("");

  const load = useCallback(
    async (range: { from: string; to: string }) => {
      if (!range.from || !range.to) {
        setError("Choose both ends of the range.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const next = await adminClient.report(range.from, range.to);
        setReport(next);
      } catch (cause) {
        setReport(null);
        setError(cause instanceof AdminHttpError ? cause.message : "Could not build the report.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load({ from, to });
    // Fired only when the range itself is committed, not on every keystroke:
    // the date inputs are two separate fields and a half-typed end date would
    // otherwise ask for a range that ends before it begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, nonce]);

  function applyRange(event: FormEvent) {
    event.preventDefault();
    setNonce((value) => value + 1);
  }

  async function runExport(kind: "csv" | "xlsx") {
    setExporting(kind);
    setFlash(null);
    try {
      // ONE route for both buttons. The XLSX path is not a second query - see
      // the header of this file.
      const csv = await adminClient.reportCsv(from, to);
      const stamp = `${from}_${to}`;
      if (kind === "csv") {
        downloadBlob(
          `cyvra-licences_${stamp}.csv`,
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
        );
      } else {
        downloadBlob(`cyvra-licences_${stamp}.xlsx`, csvToXlsx(csv, "Licences"));
      }
      setFlash({
        kind: "info",
        text:
          `${kind.toUpperCase()} downloaded for ${from} to ${to}. ` +
          `The server wrote an EXPORT_GENERATED audit row before sending the bytes, ` +
          `recording the range, the format and the row count.`,
      });
    } catch (cause) {
      setFlash({
        kind: "error",
        text: cause instanceof AdminHttpError ? cause.message : "Export failed.",
      });
    } finally {
      setExporting(null);
    }
  }

  const preview = useMemo(() => {
    if (!report) return [] as ReportRow[];
    const needle = narrow.trim().toLowerCase();
    if (needle === "") return report.rows;
    return report.rows.filter((row) =>
      Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(needle)),
    );
  }, [report, narrow]);

  const columns = useMemo(() => {
    if (preview.length === 0) return [] as string[];
    return Object.keys(preview[0]);
  }, [preview]);

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

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Licence report</h2>
          <p className="card__hint">
            Rows created between two dates, newest first. The range is the only filter this
            route accepts - everything else below narrows the preview on screen and never the
            file you download.
          </p>
        </div>

        <form className="toolbar" onSubmit={applyRange}>
          <label className="field" style={{ marginBottom: 0, width: 170 }}>
            <span className="field__label">From</span>
            <input
              className="input"
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="field" style={{ marginBottom: 0, width: 170 }}>
            <span className="field__label">To</span>
            <input
              className="input"
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button type="submit" className="btn" disabled={loading}>
            Apply range
          </button>

          <span style={{ flex: 1 }} />

          <button
            type="button"
            className="btn"
            disabled={exporting !== null || report === null}
            onClick={() => void runExport("csv")}
            title={`Server-generated CSV for ${from} to ${to}, whatever is previewed below`}
          >
            {exporting === "csv" ? "Preparing…" : "Export CSV"}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={exporting !== null || report === null}
            onClick={() => void runExport("xlsx")}
            title={`Server-generated CSV for ${from} to ${to}, converted to .xlsx in the browser`}
          >
            {exporting === "xlsx" ? "Preparing…" : "Export XLSX"}
          </button>
        </form>

        <div style={{ padding: "0 18px 14px" }}>
          <Notice kind="info">
            Both buttons download the <strong>full range</strong>
            {report ? <> ({report.count.toLocaleString()} rows)</> : null}. The text box below
            only narrows what you can see here.
          </Notice>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <div className="row row--wrap" style={{ justifyContent: "space-between" }}>
            <div>
              <h2 className="card__title">Report metadata</h2>
              <p className="card__hint">Read from the report the server just produced.</p>
            </div>
            <button type="button" className="btn btn--sm" onClick={() => setNonce((n) => n + 1)}>
              Rebuild
            </button>
          </div>
        </div>
        <div className="card__body">
          {loading ? <Spinner label="Building the report…" /> : null}
          {error ? <Notice kind="error">{error}</Notice> : null}
          {report ? (
            <dl className="dl">
              <dt>Generated by</dt>
              <dd>{report.actor}</dd>
              <dt>From</dt>
              <dd>{formatDateTime(report.from)}</dd>
              <dt>To</dt>
              <dd>{formatDateTime(report.to)}</dd>
              <dt>Row count</dt>
              <dd>
                <strong>{report.count.toLocaleString()}</strong> rows created in this range
              </dd>
              <dt>Preview</dt>
              <dd>
                {preview.length === report.count ? (
                  <Badge view={{ text: "All rows shown", tone: "green" }} />
                ) : (
                  <Badge view={{ text: `Showing ${preview.length} of ${report.count}`, tone: "amber" }} />
                )}
              </dd>
            </dl>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <div className="row row--wrap" style={{ justifyContent: "space-between" }}>
            <div>
              <h2 className="card__title">Preview</h2>
              <p className="card__hint">
                Display-only narrowing. This does not change what either export button sends.
              </p>
            </div>
            <input
              className="input"
              type="search"
              style={{ maxWidth: 260 }}
              placeholder="Narrow the preview…"
              aria-label="Narrow the preview (display only)"
              value={narrow}
              onChange={(event) => setNarrow(event.target.value)}
            />
          </div>
        </div>

        {!loading && !error && report !== null && preview.length === 0 ? (
          <EmptyState
            title="No licences were created in this range."
            hint="Widen the dates above, or clear the preview box."
          />
        ) : null}

        {preview.length > 0 ? (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 1100 }}>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, index) => (
                  <tr key={String(row.publicNumber ?? index)}>
                    {columns.map((column) => (
                      <td key={column}>{String(row[column] ?? "—")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
