import { useEffect, useState } from "react";
import { api, type AuthUser } from "./api";

type Step = "email" | "code" | "done";

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoadingSession(false));
  }, []);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api.requestOtp(email);
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
    setStep("email");
    setEmail("");
    setCode("");
    setChallengeId("");
    setDevCode(undefined);
    setNotice("");
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

      <main className="hero">
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

        <section className="card">
          {loadingSession ? (
            <p className="muted">Checking your session…</p>
          ) : user ? (
            <div className="signed-in">
              <h2>You're signed in</h2>
              <p className="muted">Account</p>
              <p className="email-pill">{user.email}</p>
              <p className="muted small">
                This is a separate mobile account (not your Windows Erase login).
              </p>
              <button className="btn ghost" onClick={logout}>
                Sign out
              </button>
            </div>
          ) : step === "email" ? (
            <form onSubmit={submitEmail}>
              <h2>Create your account</h2>
              <p className="muted">
                Enter your email and we'll send a 6-digit sign-in code.
              </p>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
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
                  setStep("email");
                  setCode("");
                  setError("");
                }}
              >
                Use a different email
              </button>
            </form>
          ) : null}

          {error && <p className="error">{error}</p>}
        </section>
      </main>

      <footer className="footer">
        <span>CYVORIQ Solutions Pvt. Ltd.</span>
        <span className="muted small">
          mobile.cyvra.co.in · logins are separate from Windows Erase
        </span>
      </footer>
    </div>
  );
}
