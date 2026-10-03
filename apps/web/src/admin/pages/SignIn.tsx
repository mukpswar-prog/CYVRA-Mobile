/**
 * SIGN-IN - the two-step code challenge (`POST /admin/auth/request` then
 * `POST /admin/auth/verify`).
 *
 * Present because the mount contract says `admin.cyvoriq.co.in` must never
 * blank out mid-migration. A console that assumed a token already existed
 * would render "not signed in" to every operator on first visit - a screen
 * that is technically correct and operationally useless.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: offer a password box, remember a code, or
 * invent a code when the server declines to send one. `mailConfigured: false`
 * with no `devCode` means there is no way in from this browser, and the
 * message says that rather than leaving an input that can never be satisfied.
 *
 * The token is written by `adminClient.verifyCode`, never here - one place in
 * the console knows how to create a session, so there is one place to audit.
 */
import { useState, type FormEvent } from "react";
import { AdminHttpError, adminClient } from "../client";
import { Field, Notice } from "../components/kit";

export function SignInPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("ceo@cyvoriq.com");
  const [challengeId, setChallengeId] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function request(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await adminClient.requestCode(email.trim());
      setChallengeId(result.challengeId);
      setDevCode(result.devCode ?? null);
      setSent(result.message);
      setStep("code");
    } catch (cause) {
      setError(cause instanceof AdminHttpError ? cause.message : "Could not send a code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminClient.verifyCode(challengeId, code.trim());
      onSignedIn();
    } catch (cause) {
      setError(cause instanceof AdminHttpError ? cause.message : "That code was not accepted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-root">
      <div style={{ maxWidth: 440, margin: "64px auto", padding: "0 20px" }}>
        <div className="card">
          <div className="card__head">
            <div className="admin-brand__mark" style={{ color: "var(--ink)" }}>
              CYVRA MOBILE
            </div>
            <p className="card__hint">Licence operations console</p>
          </div>

          <div className="card__body">
            {error ? <Notice kind="error">{error}</Notice> : null}

            {step === "email" ? (
              <form onSubmit={(event) => void request(event)}>
                <Field
                  label="Work email"
                  help="A one-time code is sent to this address. Codes expire and are single-use."
                >
                  <input
                    className="input"
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
                <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
                  {busy ? "Sending…" : "Send code"}
                </button>
              </form>
            ) : (
              <form onSubmit={(event) => void verify(event)}>
                {sent ? <p className="card__hint">{sent}</p> : null}
                {devCode ? (
                  <Notice kind="warn">
                    Mail is not configured in this environment, so the code was not sent. For
                    local use it is: <strong>{devCode}</strong>
                  </Notice>
                ) : null}
                {!devCode && sent === null ? (
                  <Notice kind="warn">
                    This environment has no mail transport and returned no development code, so
                    a code cannot be delivered from here.
                  </Notice>
                ) : null}

                <Field label="One-time code">
                  <input
                    className="input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    autoFocus
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </Field>

                <div className="row">
                  <button type="submit" className="btn btn--primary" disabled={busy || code.trim() === ""}>
                    {busy ? "Verifying…" : "Verify and enter"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      setStep("email");
                      setCode("");
                      setError(null);
                    }}
                  >
                    Use a different email
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
