import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  type AuthUser,
  type ReportDetail,
  type ReportSession,
  type ReportSummary,
} from "../api";
import { IN_STATES } from "../in-states";
import { OpsTest } from "../OpsTest";
import { ReportView } from "../ReportView";
import { SignedInHome } from "../SignedInHome";
import { Layout } from "./Layout";
import { Link, navigate } from "./router";

type Step = "register" | "code";

const emptyForm = {
  fullName: "",
  companyName: "",
  addressLine1: "",
  addressLine2: "",
  pincode: "",
  state: "",
  email: "",
};

export function WorkspaceApp(props: {
  mode: "register" | "signin" | "dashboard" | "ops";
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [step, setStep] = useState<Step>("register");
  const [form, setForm] = useState(emptyForm);
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<ReportSession[]>([]);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [reportDetail, setReportDetail] = useState<ReportDetail | null>(null);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoadingSession(false));
  }, []);

  useEffect(() => {
    if (!user) {
      setSessions([]);
      setReports([]);
      setReportDetail(null);
      return;
    }
    if (props.mode === "register" || props.mode === "signin") {
      navigate("/dashboard");
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
  }, [user, props.mode]);

  function setField(name: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submitRegister(e: FormEvent) {
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

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api.verifyOtp(challengeId, code);
      setUser(r.user);
      navigate("/dashboard");
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
    navigate("/");
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
      setReportDetail(await api.getReport(frozen.reportId));
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

  const heading =
    props.mode === "signin" ? "Welcome Back to CYVRA" : "Create Your CYVRA Account";
  const copy =
    props.mode === "signin"
      ? "Sign in with the same name, pincode and work email. We email a 6-digit code — there is no password."
      : "Start building an evidence-led device workflow. We email a 6-digit sign-in code. There is no password.";

  return (
    <Layout signedIn={Boolean(user)}>
      <div className="app-wrap">
        <section className="card app-card">
          {props.mode === "ops" ? (
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
              <h1>{heading}</h1>
              <p className="muted">{copy}</p>
              <label htmlFor="fullName">Full name *</label>
              <input
                id="fullName"
                autoComplete="name"
                value={form.fullName}
                onChange={(e) => setField("fullName", e.target.value)}
                required
                minLength={2}
              />
              <label htmlFor="companyName">Company / Organization</label>
              <input
                id="companyName"
                autoComplete="organization"
                value={form.companyName}
                onChange={(e) => setField("companyName", e.target.value)}
              />
              <label htmlFor="addressLine1">Address line 1</label>
              <input
                id="addressLine1"
                autoComplete="address-line1"
                value={form.addressLine1}
                onChange={(e) => setField("addressLine1", e.target.value)}
              />
              <label htmlFor="addressLine2">Address line 2</label>
              <input
                id="addressLine2"
                autoComplete="address-line2"
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
              <label htmlFor="email">Work email *</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
                required
              />
              <p className="muted small">
                By continuing you agree to the applicable{" "}
                <Link href="/terms">Terms</Link>,{" "}
                <Link href="/privacy">Privacy Policy</Link> and{" "}
                <Link href="/licence">Licence terms</Link>. Logins are separate
                from Windows Erase.
              </p>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Sending…" : "Email sign-in code"}
              </button>
              {props.mode === "register" ? (
                <p className="muted small">
                  Already have an account? <Link href="/sign-in">Sign in</Link>
                </p>
              ) : (
                <p className="muted small">
                  New here? <Link href="/create-account">Create account</Link>
                </p>
              )}
            </form>
          ) : (
            <form onSubmit={submitCode}>
              <h1>Verify your email</h1>
              <p className="muted">{notice}</p>
              {devCode ? (
                <p className="dev-code" aria-label="preview code">
                  Preview code: <strong>{devCode}</strong>
                </p>
              ) : null}
              <label htmlFor="code">6-digit code</label>
              <input
                id="code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Verifying…" : "Verify & sign in"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setStep("register");
                  setCode("");
                  setError("");
                }}
              >
                Edit details
              </button>
            </form>
          )}
          {error ? <p className="error">{error}</p> : null}
        </section>
      </div>
    </Layout>
  );
}
