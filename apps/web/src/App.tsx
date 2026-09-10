import { useEffect, useState } from "react";
import {
  api,
  type AuthUser,
  type ReportDetail,
  type ReportSession,
  type ReportSummary,
} from "./api";
import { IN_STATES } from "./in-states";
import { OpsTest } from "./OpsTest";
import { ReportView } from "./ReportView";
import { SignedInHome } from "./SignedInHome";

type Step = "register" | "code" | "done";

const emptyForm = {
  fullName: "",
  companyName: "",
  addressLine1: "",
  addressLine2: "",
  pincode: "",
  state: "",
  email: "",
};

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const [step, setStep] = useState<Step>("register");
  const [form, setForm] = useState(emptyForm);
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<ReportSession[]>([]);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [reportDetail, setReportDetail] = useState<ReportDetail | null>(null);
  const [showOps, setShowOps] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.location.hash === "#ops" ||
        new URLSearchParams(window.location.search).has("ops")),
  );

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoadingSession(false));
  }, []);

  useEffect(() => {
    function syncOps() {
      setShowOps(
        window.location.hash === "#ops" ||
          new URLSearchParams(window.location.search).has("ops"),
      );
    }
    window.addEventListener("hashchange", syncOps);
    return () => window.removeEventListener("hashchange", syncOps);
  }, []);

  useEffect(() => {
    if (!user) {
      setSessions([]);
      setReports([]);
      setReportDetail(null);
      return;
    }
    let cancelled = false;
    Promise.all([api.reportSessions(), api.listReports()])
      .then(([sessionRes, reportRes]) => {
        if (cancelled) return;
        setSessions(sessionRes.sessions);
        setReports(reportRes.reports);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  function setField(name: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api.requestOtp(form);
      setChallengeId(r.challengeId);
      setDevCode(r.devCode);
      setNotice(r.message);
      setStep("code");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api.verifyOtp(challengeId, code);
      setUser(r.user);
      setStep("done");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    setUser(null);
    setStep("register");
    setForm(emptyForm);
    setCode("");
    setChallengeId("");
    setDevCode(undefined);
    setNotice("");
    setSessions([]);
    setReports([]);
    setReportDetail(null);
  }

  async function freezeSession(processingSessionId: string) {
    setError("");
    setBusy(true);
    try {
      const frozen = await api.freezeReport(processingSessionId);
      const [sessionRes, reportRes] = await Promise.all([
        api.reportSessions(),
        api.listReports(),
      ]);
      setSessions(sessionRes.sessions);
      setReports(reportRes.reports);
      const detail = await api.getReport(frozen.reportId);
      setReportDetail(detail);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openReportById(reportId: string) {
    setError("");
    setBusy(true);
    try {
      setReportDetail(await api.getReport(reportId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">CYVRA</span>
          <span className="brand-sub">Mobile Evidence</span>
        </div>
        <span className="badge">Samsung — in development</span>
      </header>

      <main className={reportDetail ? "hero report-hero" : "hero"}>
        {reportDetail ? null : (
        <section className="intro">
          <h1>Android phone &amp; tablet verification you can trust.</h1>
          <p>
            CYVRA Mobile Evidence records device verification, evidence, and
            reports — honestly. Missing evidence is shown as{" "}
            <strong>LIMITED</strong> or <strong>NOT AVAILABLE</strong>, never a
            guessed grade. Verification is separate from sanitization.
          </p>
          <ul className="facts">
            <li>Samsung phones &amp; tablets supported first; other OEMs in development.</li>
            <li>No screen-lock, FRP, or account bypass. Ever.</li>
            <li>Reports are derived from preserved evidence, not assumptions.</li>
          </ul>
        </section>
        )}

        <section className={reportDetail ? "card report-card" : "card"}>
          {showOps ? (
            <OpsTest />
          ) : loadingSession ? (
            <p className="muted">Checking your session…</p>
          ) : user && reportDetail ? (
            <ReportView report={reportDetail} onBack={() => setReportDetail(null)} />
          ) : user ? (
            <SignedInHome
              fullName={user.fullName}
              email={user.email}
              companyName={user.companyName}
              sessions={sessions}
              reports={reports}
              busy={busy}
              onFreeze={freezeSession}
              onOpen={openReportById}
              onLogout={logout}
            />
          ) : step === "register" ? (
            <form onSubmit={submitRegister}>
              <h2>Create your account</h2>
              <p className="muted">
                Tell us who you are. We will send a 6-digit code to your email
                (Resend email delivery is still pending — preview shows the
                code on screen).
              </p>

              <label htmlFor="fullName">Full name *</label>
              <input
                id="fullName"
                autoComplete="name"
                placeholder="Your name"
                value={form.fullName}
                onChange={(e) => setField("fullName", e.target.value)}
                required
                minLength={2}
              />

              <label htmlFor="companyName">Company name</label>
              <input
                id="companyName"
                autoComplete="organization"
                placeholder="Company (optional)"
                value={form.companyName}
                onChange={(e) => setField("companyName", e.target.value)}
              />

              <label htmlFor="addressLine1">Address line 1</label>
              <input
                id="addressLine1"
                autoComplete="address-line1"
                placeholder="Street, building"
                value={form.addressLine1}
                onChange={(e) => setField("addressLine1", e.target.value)}
              />

              <label htmlFor="addressLine2">Address line 2</label>
              <input
                id="addressLine2"
                autoComplete="address-line2"
                placeholder="Area, landmark"
                value={form.addressLine2}
                onChange={(e) => setField("addressLine2", e.target.value)}
              />

              <div className="field-row">
                <div>
                  <label htmlFor="pincode">Pincode *</label>
                  <input
                    id="pincode"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    placeholder="560001"
                    pattern="\d{6}"
                    maxLength={6}
                    value={form.pincode}
                    onChange={(e) =>
                      setField("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    required
                  />
                </div>
                <div>
                  <label htmlFor="state">State</label>
                  <select
                    id="state"
                    value={form.state}
                    onChange={(e) => setField("state", e.target.value)}
                  >
                    <option value="">Select state</option>
                    {IN_STATES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label htmlFor="email">Email address *</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
                required
              />
              <p className="muted small">
                Used only to send the sign-in OTP from the Worker via Resend.
              </p>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send sign-in code"}
              </button>
            </form>
          ) : step === "code" ? (
            <form onSubmit={submitCode}>
              <h2>Enter your code</h2>
              <p className="muted">{notice}</p>
              {devCode && (
                <p className="dev-code" aria-label="preview code">
                  Preview code: <strong>{devCode}</strong>
                </p>
              )}
              <label htmlFor="code">6-digit code</label>
              <input
                id="code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
              <button className="btn" type="submit" disabled={busy}>
                {busy ? "Verifying…" : "Verify & sign in"}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setStep("register");
                  setCode("");
                  setError("");
                }}
              >
                Edit registration details
              </button>
            </form>
          ) : null}

          {error && <p className="error">{error}</p>}
        </section>
      </main>

      <footer className="footer">
        <span>CYVORIQ Solutions Pvt. Ltd.</span>
        <span className="muted small">
          www.cyvoriq.co.in · logins are separate from Windows Erase
          (preview: mobile.cyvra.co.in)
        </span>
      </footer>
    </div>
  );
}
