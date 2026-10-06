/**
 * THE LICENCE REGISTRY - §12 / §13's table-first landing page.
 * ============================================================
 *
 * Composition, top to bottom: quick summary strip (the summary strip lives on
 * the licence page, not only on the dashboard) -> quick-filter chips -> search
 * and filters -> the twenty-column table -> the pager.
 *
 * The card header carries §12's frozen subtitle and the toolbar carries §12's
 * three top controls - Search, Filters, Export XLSX - in §64's arrangement.
 *
 * PAGINATION IS THE ONE THING THIS PAGE NEVER RE-DERIVES.
 * The pager renders `response.pagination` untouched. It is not recomputed from
 * `response.serials.length`, not clamped to what the table holds, not rounded
 * to a whole number of pages. The server's `total`, `returned` and `hasMore`
 * are rendered as received, because the only correct value for them is the one
 * the database produced for that exact query at that exact instant.
 *
 * ROW ACTIONS run through `ActionHost`, so every state-changing click passes
 * through the §15 confirmation before a request exists. Nothing in this file
 * can call `adminClient.suspend` directly - the switch below either navigates
 * or hands a pending action to the host that owns the dialog.
 *
 * FILTER STATE IS NOT MIRRORED INTO THE PARENT.
 * `initialQuery` flows in (a KPI card on the Dashboard seeds it) and nothing
 * flows back out. A second copy of the query would be a second source of truth
 * for "what is being counted", and the strip and the table must never be able
 * to disagree about that.
 */
import { useCallback, useMemo, useState } from "react";
import {
  AdminHttpError,
  adminClient,
  buildSerialFilters,
  EMPTY_SERIAL_QUERY,
  type SerialQueryState,
} from "../client";
import { EmptyState, Notice, Spinner } from "../components/kit";
import { Pager } from "../components/Pager";
import { ActionHost, type ActionSubject, type PendingAction } from "../licences/ActionHost";
import { rowActions, type RowActionId } from "../licences/actions";
import { LicenceTable } from "../licences/LicenceTable";
import { KpiStrip, NeedsAction } from "../licences/Kpis";
import { ChipBar, Toolbar } from "../licences/Toolbar";
import { KPIS, QUEUE, useServerTotals } from "../licences/totals";
import { useSerialList } from "../licences/useSerialList";
import { LicenceDrawer } from "../drawer/LicenceDrawer";
import { useSessionState } from "../shell/session";
import { LOADING_PAGINATION } from "../pagination";
import { istDay } from "../format/datetime";
import type { LicenceListItem, SerialListResponse } from "../types";
import { csvToXlsx, downloadBlob } from "../xlsx";

const ALL_TOTALS = [...KPIS, ...QUEUE];

type Flash = { kind: "info" | "error"; text: string };

/**
 * @param initialQuery A partial seed. Merged over `EMPTY_SERIAL_QUERY` rather
 *   than used as-is, because the Dashboard hands in a *patch* - one KPI's
 *   filters - and an unmerged partial would leave the rest of the query
 *   undefined, which `buildSerialQuery` would then omit and the server would
 *   default differently from what the toolbar goes on to display.
 */
export function LicencesPage({ initialQuery }: { initialQuery?: Partial<SerialQueryState> }) {
  const { session } = useSessionState();
  const serialised = JSON.stringify(initialQuery ?? null);
  const start = useMemo(
    () => ({ ...EMPTY_SERIAL_QUERY, ...(initialQuery ?? {}) }),
    // Serialised: a parent rebuilding object literals on each render must not
    // reset the operator back to page 1.
    [serialised],
  );
  const list = useSerialList(start);
  const totals = useServerTotals(ALL_TOTALS);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [exporting, setExporting] = useState(false);

  const role = session?.role ?? null;
  const ctx = useMemo(() => ({ role }), [role]);

  // `list.patch` is itself a stable callback, so this identity only changes
  // when `useSerialList` hands back a new one - which it never does. Stable
  // here is what stops the toolbar's debounce timer being reset by every
  // unrelated render of the page.
  const patch = list.patch;

  const response: SerialListResponse | null = list.response;
  const rows = response?.serials ?? [];

  const dispatchRow = useCallback(
    async (row: LicenceListItem, id: RowActionId) => {
      const decision = rowActions(row, ctx).find((item) => item.id === id);
      if (!decision) return;
      if (!decision.enabled) {
        setFlash({ kind: "error", text: decision.reason ?? "Not available." });
        return;
      }

      switch (id) {
        case "view":
        case "viewAudit":
          setDrawerId(row.serialId);
          return;
        case "viewActivation": {
          try {
            const payload = await adminClient.activationFor(row.serialId);
            setFlash({ kind: "info", text: describeActivation(payload) });
          } catch (cause) {
            setFlash({
              kind: "error",
              text: cause instanceof AdminHttpError ? cause.message : "No activation record.",
            });
          }
          return;
        }
        case "exportRecord": {
          try {
            const csv = await adminClient.exportRecord(row.serialId);
            downloadCsv(`${row.serialId}.csv`, csv);
            setFlash({
              kind: "info",
              text: "Export downloaded. The server has written an EXPORT_GENERATED audit row for it.",
            });
          } catch (cause) {
            setFlash({
              kind: "error",
              text: cause instanceof AdminHttpError ? cause.message : "Export failed.",
            });
          }
          return;
        }
        default:
          setPending({ id, subject: row as ActionSubject });
      }
    },
    [ctx],
  );

  const openRecord = useCallback((serialId: string) => setDrawerId(serialId), []);

  /**
   * EXPORT XLSX - §12's third top control, §64's `[ Filters ] [ Export XLSX ]`.
   *
   * The bytes come from `GET /admin/reports/licences?format=csv`, the one
   * route permitted to produce a file that leaves the building. §57 REPORT
   * SECURITY is met by that route rather than by this function: authentication
   * and `report:export` permission are checked there, the report is generated
   * server-side, the `EXPORT_GENERATED` audit row is committed *before* any
   * body byte is written (so an unlogged export is unreachable), and the
   * browser only ever names filters - it never names a table, a column or a
   * sort, which is how §57's "prevent arbitrary database queries from the
   * browser" holds.
   *
   * `buildSerialFilters` drops the paging, so the workbook is every row the
   * current filters select rather than the page the operator happens to be
   * reading - a one-page file under a filename implying the whole filtered set
   * would be wrong in the direction of silently short.
   *
   * The CSV is then re-containerised by `csvToXlsx`. It is never rebuilt from
   * the list response, because that response is an ordinary unaudited read;
   * see `xlsx.ts`'s header for why the audited artefact has to stay the CSV.
   *
   * The filename is §57's controlled example verbatim - `CYVRA-Mobile-
   * Licence-Register-YYYY-MM-DD.xlsx` - because §57 asks for controlled
   * filenames and gives exactly one pattern, and a name with a free-text
   * filter string in it would be neither controlled nor stable.
   */
  async function runExport() {
    setExporting(true);
    setFlash(null);
    try {
      const csv = await adminClient.registryExportCsv(buildSerialFilters(list.query));
      downloadBlob(
        `CYVRA-Mobile-Licence-Register-${istDay()}.xlsx`,
        csvToXlsx(csv, "Licence Register"),
      );
      setFlash({
        kind: "info",
        text:
          "Licence Register exported for the filters currently applied. The server wrote an " +
          "EXPORT_GENERATED audit row before sending the bytes, recording who asked, the " +
          "format, the row count and those filters.",
      });
    } catch (cause) {
      setFlash({
        kind: "error",
        text: cause instanceof AdminHttpError ? cause.message : "Export failed.",
      });
    } finally {
      setExporting(false);
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

      <KpiStrip totals={totals} loading={totals.loading} onSelect={patch} activePatch={list.query} />

      <section className="card">
        <div className="card__head">
          <div className="row row--wrap" style={{ justifyContent: "space-between" }}>
            <div>
              <h2 className="card__title">Licence Registry</h2>
              {/*
               * §12 LICENCE REGISTRY — PRIMARY SCREEN and §64 ADMIN PAGE LAYOUT
               * — FINAL both spell this subtitle verbatim, wrapped over two
               * lines in both places. It is the frozen wording; the sentence it
               * replaced ("Search, filter and act. ...") described the
               * mechanism rather than the screen's purpose, which is the
               * marketing-flavoured failure §84 RULE 18 rules out.
               */}
              <p className="card__hint">
                Manage customer licence requests, payment, issuance, activation and control.
              </p>
            </div>
            <button type="button" className="btn btn--sm" onClick={list.reload}>
              Refresh
            </button>
          </div>
        </div>

        <Toolbar
          query={list.query}
          patch={patch}
          onClear={() => patch(EMPTY_SERIAL_QUERY)}
          onExport={runExport}
          exportBusy={exporting}
        />
        <ChipBar query={list.query} patch={patch} totals={totals} loading={totals.loading} />

        {list.error ? (
          <div style={{ padding: 18 }}>
            <Notice kind="error">
              {list.error}{" "}
              <button type="button" className="btn btn--sm" onClick={list.reload}>
                Retry
              </button>
            </Notice>
          </div>
        ) : null}

        {!list.error && list.loading && response === null ? (
          <div style={{ padding: 18 }}>
            <Spinner label="Loading licences…" />
          </div>
        ) : null}

        {response !== null && rows.length === 0 && !list.loading ? (
          <EmptyState
            title="No licences match this query."
            hint="The pager below still reports the server's totals for this query - clearing the filters is the fastest check."
          />
        ) : null}

        {rows.length > 0 ? (
          <LicenceTable
            rows={rows}
            context={{
              page: response?.pagination.page ?? 1,
              pageSize: response?.pagination.pageSize ?? 25,
              onOpen: (row) => openRecord(row.serialId),
              onPick: (row, id) => void dispatchRow(row, id),
              actionsFor: (row) => rowActions(row, ctx),
            }}
            onRowOpen={(row) => openRecord(row.serialId)}
          />
        ) : null}

        <Pager
          pagination={response?.pagination ?? LOADING_PAGINATION}
          onPageChange={(page) => patch({ page })}
          onPageSizeChange={(pageSize) => patch({ pageSize })}
          noun="licences"
          busy={response === null && !list.error}
        />
      </section>

      <NeedsAction
        totals={totals}
        loading={totals.loading}
        onSelect={patch}
        footer={
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line)" }}>
            <p className="card__hint" style={{ margin: 0 }}>
              Fifteen filterable columns plus No. and Actions. &quot;No.&quot; and
              &quot;Registered Email&quot; stay fixed while the rest scroll sideways.
            </p>
          </div>
        }
      />

      {drawerId ? (
        <LicenceDrawer
          serialId={drawerId}
          context={ctx}
          onClose={() => setDrawerId(null)}
          onAction={(id, record) => {
            const decision = rowActions(record, ctx).find((item) => item.id === id);
            if (!decision) return;
            if (!decision.enabled) {
              setFlash({ kind: "error", text: decision.reason ?? "Not available." });
              return;
            }
            if (id === "viewAudit") {
              // The trail already lives in this drawer; the row-menu entry is a
              // second route to the same place rather than a second screen.
              document.getElementById("licence-audit")?.scrollIntoView({ block: "start" });
              return;
            }
            setPending({ id, subject: record as ActionSubject });
          }}
        />
      ) : null}

      <ActionHost
        pending={pending}
        onCancel={() => setPending(null)}
        onSettled={(message) => {
          setPending(null);
          setFlash({ kind: message.kind === "success" ? "info" : "error", text: message.text });
          if (message.kind === "success") list.reload();
        }}
      />
    </div>
  );
}

function describeActivation(payload: Record<string, unknown>): string {
  const parts = Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    );
  return parts.length > 0
    ? `Activation record — ${parts.join(" · ")}`
    : "No activation record yet.";
}

/**
 * Save a CSV the server produced.
 *
 * Never used to build a file from rows already on screen: a browser-generated
 * export writes no `EXPORT_GENERATED` audit event, so it would be invisible to
 * the compliance trail that exists to answer "who took data out of here?".
 */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
