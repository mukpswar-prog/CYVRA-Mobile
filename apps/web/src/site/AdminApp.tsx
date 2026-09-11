import { useEffect, useMemo, useState } from "react";
import {
  adminApi,
  readStaffSession,
  type LicenceDraft,
  type MobileSerial,
} from "../api";
import "./admin.css";

type Tab = "licences" | "staff" | "reports";
type StaffRow = {
  staffId: string;
  email: string;
  status: string;
  nominatedBy: string;
  nominatedAt: string | null;
  revokedAt: string | null;
};

const EMPTY_DRAFT: LicenceDraft = {
  customerEmail: "",
  paymentNoted: "",
  customerKind: "SINGLE",
  deviceMax: 3,
  brandScope: "",
  customerFullName: "",
  companyName: "",
  addressLine1: "",
  addressLine2: "",
  pincode: "",
  state: "",
};

const REPORT_COLUMNS: { key: keyof MobileSerial; label: string }[] = [
  { key: "licenceKey", label: "Licence key" },
  { key: "status", label: "Status" },
  { key: "customerKind", label: "Customer type" },
  { key: "slabLabel", label: "Device slab" },
  { key: "deviceMax", label: "Max devices" },
  { key: "devicesBound", label: "Devices bound" },
  { key: "brandScope", label: "Brand scope" },
  { key: "customerEmail", label: "Customer email" },
  { key: "customerFullName", label: "Full name" },
  { key: "companyName", label: "Company" },
  { key: "addressLine1", label: "Address 1" },
  { key: "addressLine2", label: "Address 2" },
  { key: "pincode", label: "Pincode" },
  { key: "state", label: "State" },
  { key: "paymentNoted", label: "Payment noted" },
  { key: "issuedBy", label: "Issued by" },
  { key: "createdAt", label: "Created" },
  { key: "issuedAt", label: "Issued" },
  { key: "revokedAt", label: "Revoked" },
  { key: "emailedAt", label: "Emailed" },
  { key: "emailMessageId", label: "Email id" },
  { key: "emailError", label: "Email error" },
];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIsoDate(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cell(row: MobileSerial, key: keyof MobileSerial): string {
  const value = row[key];
  return value == null ? "" : String(value);
}

function downloadFile(filename: string, mime: string, body: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function toSpreadsheetMl(rows: MobileSerial[]): string {
  const header = REPORT_COLUMNS.map(
    (col) => `<Cell><Data ss:Type="String">${xmlEscape(col.label)}</Data></Cell>`,
  ).join("");
  const body = rows
    .map((row) => {
      const cells = REPORT_COLUMNS.map(
        (col) =>
          `<Cell><Data ss:Type="String">${xmlEscape(cell(row, col.key))}</Data></Cell>`,
      ).join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Licences">
  <Table>
   <Row>${header}</Row>
   ${body}
  </Table>
 </Worksheet>
</Workbook>
`;
}

function printPdf(rows: MobileSerial[], from: string, to: string) {
  const tableHead = REPORT_COLUMNS.map((col) => `<th>${xmlEscape(col.label)}</th>`).join("");
  const tableBody = rows
    .map(
      (row) =>
        `<tr>${REPORT_COLUMNS.map((col) => `<td>${xmlEscape(cell(row, col.key))}</td>`).join("")}</tr>`,
    )
    .join("");
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>CYVRA Mobile licence report</title>
  <style>
    body { font-family: Inter, sans-serif; color: #15181c; padding: 24px; }
    h1 { font-size: 20px; margin: 0 0 6px; }
    p { color: #5c6470; }
    table { border-collapse: collapse; width: 100%; font-size: 11px; }
    th, td { border: 1px solid #e6e8eb; padding: 6px 8px; text-align: left; }
    th { background: #15181c; color: #fff; }
    .mark { color: #ff7a00; }
  </style>
</head>
<body>
  <h1>CYVRA <span class="mark">Mobile</span> licence report</h1>
  <p>From ${xmlEscape(from)} to ${xmlEscape(to)} · ${rows.length} rows · emailed keys only · not Windows Erase</p>
  <table><thead><tr>${tableHead}</tr></thead><tbody>${tableBody}</tbody></table>
</body>
</html>`;
  const popup = window.open("", "_blank");
  if (!popup) return;
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function AdminApp() {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [loginEmail, setLoginEmail] = useState("ceo@cyvoriq.com");
  const [tab, setTab] = useState<Tab>("licences");
  const [draft, setDraft] = useState<LicenceDraft>(EMPTY_DRAFT);
  const [serials, setSerials] = useState<MobileSerial[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [nominateEmail, setNominateEmail] = useState("");
  const [fromDate, setFromDate] = useState(monthStartIsoDate);
  const [toDate, setToDate] = useState(todayIsoDate);
  const [reportRows, setReportRows] = useState<MobileSerial[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "CYVRA Mobile ops | Licences";
  }, []);

  useEffect(() => {
    if (!readStaffSession()) {
      setReady(true);
      return;
    }
    adminApi
      .me()
      .then((me) => {
        setEmail(me.email);
        setSuperAdmin(me.superAdmin);
      })
      .catch(() => {
        setEmail("");
      })
      .finally(() => setReady(true));
  }, []);

  const keyPreview = useMemo(() => {
    const now = new Date();
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = String(now.getUTCFullYear());
    const kind = draft.customerKind === "BULK" ? "B" : "S";
    return `CYVRA${dd}${mm}${yyyy}${kind}XXXX-1-${draft.deviceMax}`;
  }, [draft.customerKind, draft.deviceMax]);

  async function run(action: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshLicences() {
    const list = await adminApi.listSerials();
    setSerials(list.serials);
    return list.serials.length;
  }

  if (!ready) {
    return <div className="ops-login-panel">Loading ops…</div>;
  }

  if (!email) {
    return (
      <div className="ops-login">
        <section className="ops-login-brand">
          <div>
            <img src="/brand/cyvoriq-logo.png" alt="CYVORIQ Solutions" />
            <h1>
              CYVRA <span className="ops-accent">Mobile ops</span>
            </h1>
            <p>
              Generate, approve, and track licences. Same layout family as Erase
              admin, graphite and CYVRA orange — not teal, not Windows licences.
            </p>
          </div>
          <p className="small">
            Super admin <span className="ops-accent">ceo@cyvoriq.com</span>
            <br />
            Only nominated @cyvoriq.com inboxes can sign in.
          </p>
        </section>
        <section className="ops-login-panel">
          <form
            className="ops-login-card"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                if (!challengeId) {
                  const requested = await adminApi.requestStaffCode(loginEmail);
                  setChallengeId(requested.challengeId);
                  setDevCode(requested.devCode ?? "");
                  setNotice(requested.message);
                  return;
                }
                const verified = await adminApi.verifyStaffCode(challengeId, code);
                setEmail(verified.operator.email);
                setSuperAdmin(verified.operator.superAdmin);
                setNotice("");
              });
            }}
          >
            <h2>Ops sign in</h2>
            <p className="muted small">
              A 6-digit code is emailed to the verified staff inbox. Phone is
              not used.
            </p>
            <label htmlFor="opsEmail">@cyvoriq.com email</label>
            <input
              id="opsEmail"
              type="email"
              autoComplete="username"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              disabled={Boolean(challengeId)}
            />
            {challengeId ? (
              <>
                <label htmlFor="opsCode">6-digit code</label>
                <input
                  id="opsCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </>
            ) : null}
            {devCode ? (
              <p className="dev-code">Preview code {devCode}</p>
            ) : null}
            {notice ? <p className="dev-code">{notice}</p> : null}
            {error ? <p className="error">{error}</p> : null}
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {challengeId ? "Verify and enter" : "Email sign-in code"}
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="ops-shell">
      <aside className="ops-nav">
        <img src="/brand/cyvoriq-logo.png" alt="" />
        <strong>CYVRA MOBILE</strong>
        <button
          type="button"
          className={tab === "licences" ? "is-on" : ""}
          onClick={() => setTab("licences")}
        >
          Licences
        </button>
        <button
          type="button"
          className={tab === "staff" ? "is-on" : ""}
          onClick={() => setTab("staff")}
        >
          Staff
        </button>
        <button
          type="button"
          className={tab === "reports" ? "is-on" : ""}
          onClick={() => setTab("reports")}
        >
          Reports
        </button>
        <div className="ops-actor">
          <div>{email}</div>
          <button
            type="button"
            onClick={() =>
              run(async () => {
                await adminApi.logoutStaff();
                setEmail("");
                setSuperAdmin(false);
                setChallengeId("");
                setCode("");
              })
            }
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="ops-main">
        {tab === "licences" ? (
          <>
            <h2>Generate and approve licences</h2>
            <p className="muted small">
              Key policy: <code>CYVRAddmmyyyy</code> + S/B + 4 hex + slab (
              <code>1-3</code>, <code>1-5</code>, <code>1-7</code>,{" "}
              <code>1-25</code>). Same key, same brand, up to the slab. Approve
              emails the key to the customer inbox only. Payment noted is a
              human attestation, not a gateway.
            </p>
            <section className="ops-card">
              <p className="muted small">
                Preview: <span className="ops-key">{keyPreview}</span>
              </p>
              <div className="ops-grid">
                <div>
                  <label htmlFor="customerEmail">Verified customer email</label>
                  <input
                    id="customerEmail"
                    type="email"
                    value={draft.customerEmail}
                    onChange={(event) =>
                      setDraft({ ...draft, customerEmail: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="customerFullName">Customer full name</label>
                  <input
                    id="customerFullName"
                    value={draft.customerFullName}
                    onChange={(event) =>
                      setDraft({ ...draft, customerFullName: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="companyName">Company</label>
                  <input
                    id="companyName"
                    value={draft.companyName}
                    onChange={(event) =>
                      setDraft({ ...draft, companyName: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="brandScope">Brand scope (same key)</label>
                  <input
                    id="brandScope"
                    placeholder="SAMSUNG"
                    value={draft.brandScope}
                    onChange={(event) =>
                      setDraft({ ...draft, brandScope: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="customerKind">Customer type</label>
                  <select
                    id="customerKind"
                    value={draft.customerKind}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        customerKind: event.target.value as LicenceDraft["customerKind"],
                      })
                    }
                  >
                    <option value="SINGLE">Single user</option>
                    <option value="BULK">Bulk licence</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="deviceMax">Device slab</label>
                  <select
                    id="deviceMax"
                    value={draft.deviceMax}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        deviceMax: Number(event.target.value) as LicenceDraft["deviceMax"],
                      })
                    }
                  >
                    <option value={3}>1-3 devices</option>
                    <option value={5}>1-5 devices</option>
                    <option value={7}>1-7 devices</option>
                    <option value={25}>1-25 devices</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="addressLine1">Address line 1</label>
                  <input
                    id="addressLine1"
                    value={draft.addressLine1}
                    onChange={(event) =>
                      setDraft({ ...draft, addressLine1: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="addressLine2">Address line 2</label>
                  <input
                    id="addressLine2"
                    value={draft.addressLine2}
                    onChange={(event) =>
                      setDraft({ ...draft, addressLine2: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="pincode">Pincode</label>
                  <input
                    id="pincode"
                    value={draft.pincode}
                    onChange={(event) =>
                      setDraft({ ...draft, pincode: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="state">State</label>
                  <input
                    id="state"
                    value={draft.state}
                    onChange={(event) =>
                      setDraft({ ...draft, state: event.target.value })
                    }
                  />
                </div>
              </div>
              <label htmlFor="paymentNoted">Payment noted</label>
              <input
                id="paymentNoted"
                placeholder="UPI / NEFT reference and date"
                value={draft.paymentNoted}
                onChange={(event) =>
                  setDraft({ ...draft, paymentNoted: event.target.value })
                }
              />
              <div className="ops-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const created = await adminApi.createSerial(draft);
                      setNotice(
                        `Generated ${created.serial.licenceKey} (${created.serial.status}). Approve to email the key.`,
                      );
                      await refreshLicences();
                    })
                  }
                >
                  Generate PENDING
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const count = await refreshLicences();
                      setNotice(`Listed ${count} licences`);
                    })
                  }
                >
                  Refresh list
                </button>
              </div>
            </section>
            <LicenceTable
              serials={serials}
              busy={busy}
              onIssue={(serialId) =>
                run(async () => {
                  const issued = await adminApi.issueSerial(serialId);
                  setNotice(
                    `${issued.serial.licenceKey} approved${issued.emailed ? " and emailed" : " (email not sent in preview)"}`,
                  );
                  await refreshLicences();
                })
              }
              onRevoke={(serialId) =>
                run(async () => {
                  const revoked = await adminApi.revokeSerial(serialId);
                  setNotice(`${revoked.serial.licenceKey} revoked`);
                  await refreshLicences();
                })
              }
            />
          </>
        ) : null}

        {tab === "staff" ? (
          <>
            <h2>Nominated operators</h2>
            <p className="muted small">
              Super admin is always <code>ceo@cyvoriq.com</code>. Only that
              inbox can nominate or revoke other @cyvoriq.com operators.
            </p>
            {superAdmin ? (
              <section className="ops-card">
                <label htmlFor="nominateEmail">Nominate @cyvoriq.com</label>
                <input
                  id="nominateEmail"
                  type="email"
                  value={nominateEmail}
                  onChange={(event) => setNominateEmail(event.target.value)}
                />
                <div className="ops-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await adminApi.nominateStaff(nominateEmail);
                        setNotice(`${result.operator.email} ${result.operator.status}`);
                        const list = await adminApi.listStaff();
                        setStaff(list.operators);
                      })
                    }
                  >
                    Nominate and approve
                  </button>
                </div>
              </section>
            ) : (
              <p className="muted">Only the CEO can nominate staff.</p>
            )}
            <div className="ops-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const list = await adminApi.listStaff();
                    setStaff(list.operators);
                    setNotice(`Listed ${list.operators.length} operators`);
                  })
                }
              >
                Refresh staff
              </button>
            </div>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Nominated by</th>
                    <th>Nominated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((row) => (
                    <tr key={row.staffId}>
                      <td>{row.email}</td>
                      <td>
                        <span className={`ops-status ${row.status}`}>{row.status}</span>
                      </td>
                      <td>{row.nominatedBy}</td>
                      <td>{row.nominatedAt ?? ""}</td>
                      <td>
                        {superAdmin && row.status === "APPROVED" ? (
                          <button
                            type="button"
                            className="btn btn-ghost compact"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await adminApi.revokeStaff(row.staffId);
                                const list = await adminApi.listStaff();
                                setStaff(list.operators);
                              })
                            }
                          >
                            Revoke
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === "reports" ? (
          <>
            <h2>Management licence report</h2>
            <p className="muted small">
              Rows and columns from a from-date to a to-date. Download Excel
              (.xls) or CSV, or print to PDF. Captures every stored customer
              and licence field.
            </p>
            <section className="ops-card">
              <div className="ops-grid">
                <div>
                  <label htmlFor="fromDate">From date</label>
                  <input
                    id="fromDate"
                    type="date"
                    value={fromDate}
                    onChange={(event) => setFromDate(event.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="toDate">To date</label>
                  <input
                    id="toDate"
                    type="date"
                    value={toDate}
                    onChange={(event) => setToDate(event.target.value)}
                  />
                </div>
              </div>
              <div className="ops-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const report = await adminApi.licenceReport(fromDate, toDate);
                      setReportRows(report.rows);
                      setNotice(`${report.count} rows from ${fromDate} to ${toDate}`);
                    })
                  }
                >
                  Run report
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy || reportRows.length === 0}
                  onClick={() =>
                    run(async () => {
                      const csv = await adminApi.licenceReportCsv(fromDate, toDate);
                      downloadFile(
                        "cyvra-mobile-licences.csv",
                        "text/csv;charset=utf-8",
                        csv,
                      );
                    })
                  }
                >
                  Download CSV
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={reportRows.length === 0}
                  onClick={() =>
                    downloadFile(
                      "cyvra-mobile-licences.xls",
                      "application/vnd.ms-excel",
                      toSpreadsheetMl(reportRows),
                    )
                  }
                >
                  Download Excel
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={reportRows.length === 0}
                  onClick={() => printPdf(reportRows, fromDate, toDate)}
                >
                  Print / PDF
                </button>
              </div>
            </section>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    {REPORT_COLUMNS.map((col) => (
                      <th key={col.key}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((row) => (
                    <tr key={row.serialId}>
                      {REPORT_COLUMNS.map((col) => (
                        <td key={col.key} className={col.key === "licenceKey" ? "ops-key" : ""}>
                          {cell(row, col.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {notice ? <p className="dev-code">{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </main>
    </div>
  );
}

function LicenceTable(props: {
  serials: MobileSerial[];
  busy: boolean;
  onIssue: (serialId: string) => void;
  onRevoke: (serialId: string) => void;
}) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>Licence key</th>
            <th>Status</th>
            <th>Type</th>
            <th>Slab</th>
            <th>Brand</th>
            <th>Customer</th>
            <th>Emailed</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {props.serials.map((serial) => (
            <tr key={serial.serialId}>
              <td className="ops-key">{serial.licenceKey}</td>
              <td>
                <span className={`ops-status ${serial.status}`}>{serial.status}</span>
              </td>
              <td>{serial.customerKind}</td>
              <td>{serial.slabLabel}</td>
              <td>{serial.brandScope}</td>
              <td>
                {serial.customerEmail}
                <div className="muted small">{serial.customerFullName}</div>
              </td>
              <td>{serial.emailedAt ?? serial.emailError ?? "—"}</td>
              <td>
                {serial.status === "PENDING" ? (
                  <button
                    type="button"
                    className="btn btn-primary compact"
                    disabled={props.busy}
                    onClick={() => props.onIssue(serial.serialId)}
                  >
                    Approve & email
                  </button>
                ) : serial.status === "ISSUED" ? (
                  <button
                    type="button"
                    className="btn btn-ghost compact"
                    disabled={props.busy}
                    onClick={() => props.onRevoke(serial.serialId)}
                  >
                    Revoke
                  </button>
                ) : (
                  <span className="muted small">revoked</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
