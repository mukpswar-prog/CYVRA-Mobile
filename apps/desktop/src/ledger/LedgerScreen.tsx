import { useMemo } from "react";
import { chainProblems, EVENT_LABEL, EVENT_NOTE, parseLedgerJsonl } from "./parseLedger";
import "./LedgerScreen.css";

export interface LedgerScreenProps {
  loading: boolean;
  /** A bridge failure - the ledger could not be reached at all. */
  error: string | null;
  /** The file verbatim, or `null` when this installation has no ledger yet. */
  raw: string | null;
  /** The Rust side's verdict after recomputing every entry's hash. */
  verified: boolean | null;
  /** How many entries Rust decoded, used to cross-check this reader. */
  decodedCount: number;
  onRefresh: () => void;
}

const SOURCE = "<cyvra.home>/logs/ledger.jsonl";

const LIVE_TITLE =
  "Recorded while the workstation was on a live, server-confirmed state.";
const OFFLINE_TITLE =
  "Recorded while the workstation was riding its offline grace window - cached state, not a fresh answer from the server.";

/**
 * The "Transaction Ledger" view: the append-only chain, read straight from
 * `ledger.jsonl`.
 *
 * Presentation only. Every value on screen comes from the file; nothing here
 * computes, infers or embellishes an event. Where two readers disagree - this
 * one and the Rust bridge's - the disagreement is shown rather than resolved
 * silently, because which of them is wrong is exactly what an auditor needs to
 * find out.
 */
export function LedgerScreen({
  loading,
  error,
  raw,
  verified,
  decodedCount,
  onRefresh,
}: LedgerScreenProps) {
  const parsed = useMemo(() => (raw === null ? null : parseLedgerJsonl(raw)), [raw]);
  const problems = useMemo(() => (parsed ? chainProblems(parsed.rows) : []), [parsed]);

  const rows = parsed?.rows ?? [];
  const unreadable = parsed?.unreadable ?? [];
  // Nothing on disk is only "nothing" once the read has actually finished:
  // while it is in flight, an absent file is an unanswered question.
  const nothingOnDisk = error === null && raw === null && !loading;
  const disagree = parsed !== null && decodedCount !== parsed.rows.length;

  return (
    <div className="workspace ledger-screen">
      <div className="ledger-head">
        <h1 className="page-title">Transaction Ledger</h1>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Re-read the transaction ledger"
        >
          {loading ? "Reading..." : "Re-read"}
        </button>
      </div>

      <p className="workflow-note">
        Every row below is one line of <strong>{SOURCE}</strong>, read as written and shown in the
        order it was recorded. Times are UTC exactly as the file holds them. Nothing here is
        edited, summarised or converted.
      </p>

      {error !== null && (
        <div className="band band-error" role="alert">
          <strong>LEDGER COULD NOT BE READ</strong>
          <span>{error}</span>
        </div>
      )}

      {nothingOnDisk && (
        <div className="band band-note">
          <strong>NO LEDGER YET</strong>
          <span>
            This workstation has recorded nothing. An absent ledger means nothing has happened yet
            - it is not the same as a ledger that is missing or broken, and it will not be called
            one until there is a line to doubt.
          </span>
        </div>
      )}

      {verified === true && (
        <div className="band band-ok" data-testid="chain-ok">
          <strong>CHAIN INTACT</strong>
          <span>
            {rows.length === 1 ? "1 entry" : `${rows.length} entries`}, each hash recomputed by the
            bridge and found to match its own contents and its predecessor&apos;s.
          </span>
        </div>
      )}

      {verified === false && (
        <div className="band band-error" role="alert" data-testid="chain-broken">
          <strong>CHAIN DOES NOT CHECK OUT</strong>
          <span>
            The file was read, but at least one entry&apos;s SHA-256 does not match what that entry
            now says. Nothing has been repaired or rewritten - the file is exactly as found, because
            an entry that no longer matches is the evidence and rewriting it would be destroying it.
          </span>
        </div>
      )}

      {(unreadable.length > 0 || problems.length > 0) && (
        <div className="band band-blocked" role="alert" data-testid="chain-problems">
          <strong>LINES THAT DO NOT READ BACK</strong>
          <span>
            <ul className="ledger-problems">
              {unreadable.map((item) => (
                <li key={`unreadable-${item.line}`}>
                  Line {item.line}: {item.reason}
                </li>
              ))}
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </span>
        </div>
      )}

      {disagree && (
        <div className="band band-blocked" role="alert" data-testid="reader-disagreement">
          <strong>TWO READERS DISAGREE</strong>
          <span>
            The bridge decoded {decodedCount} {decodedCount === 1 ? "entry" : "entries"}; this view
            parsed {parsed === null ? 0 : parsed.rows.length}{" "}
            {parsed !== null && parsed.rows.length === 1 ? "entry" : "entries"} from the same file.
            Both counts are shown rather than the more convenient one - a ledger two readers cannot
            agree on is not a ledger either of them should be quoting.
          </span>
        </div>
      )}

      <section className="ledger-table-wrap" aria-labelledby="ledger-table-title">
        <div className="device-grid-head">
          <div className="device-grid-titles">
            <h2 id="ledger-table-title" className="section-label">
              Recorded chain
            </h2>
            <p className="hint">
              Provenance says whether an event was taken from a live server answer or from the
              workstation&apos;s cached offline state. Hover any badge or event for the full
              wording.
            </p>
          </div>

          <div className="device-badges">
            <span className="count-badge" title="Entries parsed from ledger.jsonl.">
              <strong>{rows.length}</strong>
              <span>Entries</span>
            </span>
            <span
              className={`count-badge ${rows.some((row) => row.offline) ? "" : "is-authorized"}`}
              title="Entries recorded while the workstation was on its offline grace window."
            >
              <strong>{rows.filter((row) => row.offline).length}</strong>
              <span>Offline</span>
            </span>
            <span
              className="count-badge"
              title="Entries recorded while the workstation was on a live, server-confirmed state."
            >
              <strong>{rows.filter((row) => !row.offline).length}</strong>
              <span>Live</span>
            </span>
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <table className="data-grid is-loading">
            <caption className="visually-hidden">Reading the transaction ledger</caption>
            <tbody>
              {[0, 1, 2].map((placeholder) => (
                <tr key={placeholder} className="is-skeleton">
                  <td colSpan={6}>
                    <span className="skeleton-bar" aria-hidden="true" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : rows.length === 0 ? (
          <div className="band band-idle">
            <strong>NOTHING RECORDED</strong>
            <span>
              The file was read and holds no entries this view could parse. If the counts above
              disagree, read the band before drawing any conclusion from an empty table.
            </span>
          </div>
        ) : (
          <table className="data-grid ledger-grid">
            <caption className="visually-hidden">
              Entries in ledger.jsonl, oldest first
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Recorded at (UTC)</th>
                <th scope="col">Event</th>
                <th scope="col">Provenance</th>
                <th scope="col">Subject</th>
                <th scope="col">Chain link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.seq}-${row.hash}`}>
                  <td className="ledger-seq">{row.seq}</td>
                  <td className="ledger-at">
                    <time dateTime={row.at}>{row.at}</time>
                  </td>
                  <td>
                    <span className="ledger-event" title={EVENT_NOTE[row.event]}>
                      {EVENT_LABEL[row.event]}
                    </span>
                    <span className="ledger-event-code">{row.event}</span>
                  </td>
                  <td>
                    {row.offline ? (
                      <span className="prov-badge prov-offline" title={OFFLINE_TITLE}>
                        OFFLINE
                      </span>
                    ) : (
                      <span className="prov-badge prov-live" title={LIVE_TITLE}>
                        LIVE
                      </span>
                    )}
                  </td>
                  <td className="ledger-subject">
                    {row.subject === null ? <span className="muted-cell">Not applicable</span> : row.subject}
                  </td>
                  <td className="ledger-chain">
                    <span className="chain-line">
                      <b>prev</b> {row.prev}
                    </span>
                    <span className="chain-line">
                      <b>hash</b> {row.hash}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="help-card" aria-label="About this view">
        <div className="help-head">
          <h2>How to read this</h2>
        </div>
        <div className="help-body">
          <ul className="help-list">
            <li>
              <strong>LIVE</strong> means the event came from a server-confirmed state.{" "}
              <strong>OFFLINE</strong> means it was recorded while the workstation was running on
              the offline grace window, so it is cached state and is labelled as such rather than
              presented as a fresh answer.
            </li>
            <li>
              <strong>Scan reserved</strong> spends nothing. Only <strong>Scan spent on a
              certificate</strong> does, and it appears once per certificate however many times
              that report is fetched.
            </li>
            <li>
              The <strong>CHAIN INTACT</strong> verdict is SHA-256 recomputed entry by entry by the
              workstation. The table above is this view reading the same file independently, and it
              checks structure - sequence and links - not bytes. The two are shown side by side on
              purpose.
            </li>
            <li>
              Nothing on this screen repairs, reorders or rewrites the file. A ledger that no
              longer checks out is left exactly as found.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}

export default LedgerScreen;
