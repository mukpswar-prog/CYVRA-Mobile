import { useId, useState, type FormEvent } from "react";
import cyvoriqLogo from "../assets/cyvoriq-solutions.png";
import termsText from "../../assets/docs/TERMS_V1.0-DRAFT.md?raw";
import "./ActivationScreen.css";

/**
 * What the screen collects, and nothing else.
 *
 * No terms version, no app version and no device fingerprint travel with these:
 * the binary supplies all three, so a modified frontend cannot claim the
 * operator accepted terms it never showed them.
 */
export type ActivationFields = {
  email: string;
  licenceKey: string;
};

type ActivationScreenProps = {
  /**
   * One of the six verdicts, verbatim, or `null` when there is nothing to
   * report. Never a stack trace, an HTTP status or a storage detail - if the
   * caller ever has one of those, the correct value here is `null`.
   */
  message: string | null;
  /** Terms version this build bundles, echoed from the Rust side. */
  termsVersion: string;
  /** True while a submission is in flight; the form locks until it settles. */
  busy: boolean;
  onSubmit: (fields: ActivationFields) => void;
};

/**
 * "Sign in & Activate" - the whole product for anyone who has not activated.
 *
 * The terms checkbox starts unchecked and there is no state anywhere that
 * could pre-tick it: acceptance has to be an act of the operator sitting in
 * front of this window. ACTIVATE is disabled until both fields are non-empty
 * and that box is ticked, so the server is never asked about a half-entered
 * licence.
 */
export function ActivationScreen({
  message,
  termsVersion,
  busy,
  onSubmit,
}: ActivationScreenProps) {
  const emailId = useId();
  const keyId = useId();
  const termsId = useId();

  const [email, setEmail] = useState("");
  const [licenceKey, setLicenceKey] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  /**
   * The rule is deliberately thin: non-empty and accepted. The screen does not
   * guess what a Registered User ID should look like - the server is the
   * authority on that and answers `invalid user` if it is wrong, which is a
   * verdict the operator is entitled to see rather than one a regex should
   * have swallowed.
   */
  const fieldsEntered = email.trim().length > 0 && licenceKey.trim().length > 0;
  const canActivate = fieldsEntered && accepted && !busy;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canActivate) return;

    onSubmit({ email: email.trim(), licenceKey: licenceKey.trim() });
  }

  return (
    <main className="activation">
      <header className="activation-brand">
        <img className="activation-logo" src={cyvoriqLogo} alt="CYVRA Mobile" />
        <h1 className="activation-title">CYVRA MOBILE</h1>
        <p className="activation-subtitle">Mobile Device Evidence Platform</p>
      </header>

      <form className="activation-card" onSubmit={handleSubmit} noValidate>
        <h2 className="activation-heading">Sign in &amp; Activate</h2>

        {message !== null && message !== "" ? (
          <p className="activation-message" role="alert">
            {message}
          </p>
        ) : null}

        <div className="activation-field">
          <label htmlFor={emailId}>Registered User ID (email)</label>
          <input
            id={emailId}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            spellCheck={false}
            disabled={busy}
          />
        </div>

        <div className="activation-field">
          <label htmlFor={keyId}>Licence Key</label>
          <input
            id={keyId}
            type="password"
            value={licenceKey}
            onChange={(event) => setLicenceKey(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </div>

        <div className="activation-terms">
          <input
            id={termsId}
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            disabled={busy}
          />
          <div className="activation-terms-body">
            <label htmlFor={termsId}>
              I have read and accept the Software Licence Terms
            </label>
            <button
              type="button"
              className="activation-link"
              aria-expanded={showTerms}
              onClick={() => setShowTerms((open) => !open)}
            >
              View Software Licence Terms
            </button>
          </div>
        </div>

        {showTerms ? (
          <section className="activation-terms-sheet" aria-label="Software Licence Terms">
            <h3>CYVRA Mobile Software Licence Terms - Version: {termsVersion}</h3>
            <pre>{termsText}</pre>
          </section>
        ) : null}

        <button className="activation-submit" type="submit" disabled={!canActivate}>
          ACTIVATE
        </button>

        <button
          type="button"
          className="activation-help"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((open) => !open)}
        >
          Need help? Contact CYVORIQ Support
        </button>

        {showHelp ? (
          <p className="activation-help-note">
            Have your Registered User ID and Licence Key ready. CYVORIQ Solutions
            support can confirm whether your licence is active and which
            computers it is already bound to. CYVORIQ Solutions - cyvoriq.co.in
          </p>
        ) : null}
      </form>
    </main>
  );
}
