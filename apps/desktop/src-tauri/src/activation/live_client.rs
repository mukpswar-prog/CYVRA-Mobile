//! A licence transport that can actually reach a server - when one is configured.
//!
//! This is the W1.5 counterpart to [`crate::activation::client`]: that module is
//! a seam with no wire, this one has a wire but no default URL. Production only
//! ever uses it once [`BASE_URL_ENV`] has been set, so a build with no endpoint
//! configured behaves exactly as it did before - [`crate::activation::client`]'
//! [`crate::activation::api::FailureKind::NetworkError`] to everything, which is
//! [`crate::activation::api::Reachability::Unreachable`] and nothing else.
//!
//! # What is specified and what is assumed
//!
//! `docs/API_CONTRACT_ACTIVATION.md` was written to record what the code says,
//! and it says this transport does not exist. Three of its sections are the
//! reason this module has no default endpoint:
//!
//! * §2 L42 - the path is *"unknown - not specified in code"*.
//! * §2 L54 - *"No route anywhere in the repo accepts `ActivationRequest` or
//!   returns `ActivationSuccess`."*
//! * §12 L321 - *"None of the following is specified anywhere in the code"*,
//!   covering endpoint URL, wire format, revalidation authentication and the
//!   server's own verdict mapping.
//!
//! Verified independently of that document: `services/api/src/index.ts:241-244`
//! mounts exactly four route groups (`/evidence`, `/reports`, `/license`,
//! `/admin`), and grepping all of `services/` for `activation|licence_key|
//! device_fingerprint|ActivationRequest` returns two hits, both a key-format
//! regex in `licenceKey.ts`.
//!
//! So this module separates the two halves honestly:
//!
//! * **Specified by existing code** - the [`crate::activation::api::LicenseApiClient`]
//!   contract, the `ActivationRequest` / `ActivationSuccess` shapes, the six
//!   [`crate::activation::api::FailureKind`] verdicts and their
//!   [`crate::activation::api::FailureKind::code`] strings, and the rule that an
//!   unknown answer collapses to `NetworkError` rather than inventing a seventh
//!   string (`api.rs:31-34`).
//! * **Assumed, and marked as assumed** - the URL paths in [`Endpoints`]. They
//!   are overridable so the assumption is never load-bearing, and the encoding
//!   is JSON with the derives' own snake_case names because that is the only
//!   encoding requiring no new choice.
//!
//! # What this client refuses to do
//!
//! * It never logs a request body. Payloads carry the operator's email, their
//!   licence key and the stored device token; log lines quote paths and status
//!   codes only.
//! * It never follows a redirect. A `POST` carrying an email and a licence key
//!   that gets replayed to a different host is a leak, so a `3xx` is a transport
//!   failure rather than an invitation.
//! * It never retries a first binding. [`crate::activation::api::LicenseApiClient::activate`]
//!   writes a device binding; repeating it would be a second binding, so it gets
//!   one attempt and no budget (see [`Options::retry_budget`]).
//! * It never invents a verdict. An answer that is not one of the six codes, or
//!   that is not parseable at all, is logged and returned as `NetworkError`.

use crate::activation::api::{
    ActivationOutcome, ActivationRequest, ActivationSuccess, BindingOutcome, FailureKind,
    LicenseApiClient, Reachability, SignedSnapshot,
};
use crate::activation::client::PlaceholderLicenseApiClient;
use crate::ledger::{Clock, SystemClock};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::OnceLock;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Environment variable that opts a build into this client.
///
/// Read once, on first use. Absent (or empty, or unparseable) means the
/// shipped [`crate::activation::client::PlaceholderLicenseApiClient`] stays in
/// place and the application cannot activate anybody - which is the default,
/// and deliberately so.
///
/// The value is a base URL such as `https://api.cyvoriq.co.in/`. It carries no
/// credential: a URL with a user or password embedded is rejected by
/// [`ConfigError::`] rather than accepted quietly.
pub const BASE_URL_ENV: &str = "CYVRA_ACTIVATION_BASE_URL";

/// Request paths, appended to the configured base URL.
///
/// **ASSUMPTION - not taken from `docs/API_CONTRACT_ACTIVATION.md`.** §12 item 1
/// records that no path exists anywhere in the code or the document. These are
/// a placeholder shape for the three calls the trait defines; they are public
/// and overridable through [`Options::endpoints`] so that when the real route
/// is written, nothing in this file has to be guessed a second time.
///
/// They are *not* read from an environment variable, because a wrong path on a
/// right host returns 404 and that is a loud, honest failure rather than a
/// silent one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    /// `POST` target for a first activation.
    pub activate: String,
    /// `POST` target for a read-only revalidation of a stored device token.
    pub revalidate: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            activate: "v1/activation".to_string(),
            revalidate: "v1/activation/revalidate".to_string(),
        }
    }
}

/// How long one call may take, how long a whole operation may take, and how
/// often a read-only one may be repeated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub endpoints: Endpoints,
    /// Transport-level ceiling handed to the HTTP stack: connect and response.
    pub timeout: Duration,
    /// Total seconds a single operation may spend, **measured on the injected
    /// [`Clock`]** rather than on `SystemTime`.
    ///
    /// This is the budget that bounds retries. It is not a sleep: the clock is
    /// read, compared against a deadline, and nothing waits on it, which is
    /// exactly why a test can move the clock and observe the retry policy change.
    pub budget_secs: u64,
    /// Extra attempts after the first, for operations that are safe to repeat.
    ///
    /// `0` disables retrying. [`LicenseApiClient::activate`] ignores this
    /// entirely and always makes exactly one attempt: a first binding is a
    /// write, and a repeated write is a second binding.
    pub retry_budget: u8,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            endpoints: Endpoints::default(),
            timeout: Duration::from_secs(10),
            budget_secs: 30,
            retry_budget: 2,
        }
    }
}

/// Why an endpoint could not be accepted.
///
/// Configuration failure, not a licence verdict: it never becomes an operator
/// string, it stops the live client from being constructed at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigError {
    /// Empty, whitespace, or not a URL.
    UnparsableUrl,
    /// No scheme, or a scheme that is not `http`/`https`.
    UnsupportedScheme,
    /// A URL with nothing behind it.
    MissingHost,
    /// `user:password@host`. Credentials belong in a secret store, never in a
    /// URL that ends up in a log line, a `.env` or a build argument.
    CredentialInUrl,
    /// The HTTP client itself could not be built.
    TransportUnavailable,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            ConfigError::UnparsableUrl => "the configured endpoint is not a URL",
            ConfigError::UnsupportedScheme => "the configured endpoint must be http or https",
            ConfigError::MissingHost => "the configured endpoint has no host",
            ConfigError::CredentialInUrl => {
                "the configured endpoint embeds a user or password; credentials do not belong in a URL"
            }
            ConfigError::TransportUnavailable => "the HTTP transport could not be built",
        };
        f.write_str(message)
    }
}

impl std::error::Error for ConfigError {}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/// A licence client bound to one configured endpoint.
///
/// Total by construction: [`LicenseApiClient`] requires that every method
/// answer rather than return a `Result`, so every failure below - DNS, TLS,
/// timeout, unreadable body, unparsable body, unknown verdict - is logged and
/// becomes [`FailureKind::NetworkError`]. Nothing here can panic on a bad
/// answer, and nothing here can return a seventh operator string.
pub struct LiveLicenseApiClient {
    http: reqwest::blocking::Client,
    base: reqwest::Url,
    activate_url: reqwest::Url,
    revalidate_url: reqwest::Url,
    options: Options,
    clock: Box<dyn Clock + Send + Sync>,
}

// `Debug` is written by hand because the clock is a trait object without a
// `Debug` bound. It prints the resolved paths and nothing else: no request has
// been made yet, so there is no token, email or key to leak by accident.
impl fmt::Debug for LiveLicenseApiClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LiveLicenseApiClient")
            .field("activate", &self.activate_url.as_str())
            .field("revalidate", &self.revalidate_url.as_str())
            .field("timeout", &self.options.timeout)
            .field("budget_secs", &self.options.budget_secs)
            .field("retry_budget", &self.options.retry_budget)
            .finish()
    }
}

impl LiveLicenseApiClient {
    /// Bind to `base_url` with [`Options::default`].
    pub fn new(
        base_url: &str,
        clock: impl Clock + Send + Sync + 'static,
    ) -> Result<Self, ConfigError> {
        Self::with_options(base_url, Options::default(), clock)
    }

    /// Bind to `base_url` with explicit options.
    pub fn with_options(
        base_url: &str,
        options: Options,
        clock: impl Clock + Send + Sync + 'static,
    ) -> Result<Self, ConfigError> {
        let mut base = parse_base(base_url)?;
        normalise_base(&mut base);

        // Both paths are validated at construction so a malformed endpoint is a
        // startup error, not a surprise on the operator's first attempt.
        let activate_url = base
            .join(&options.endpoints.activate)
            .map_err(|_| ConfigError::UnparsableUrl)?;
        let revalidate_url = base
            .join(&options.endpoints.revalidate)
            .map_err(|_| ConfigError::UnparsableUrl)?;

        let http = reqwest::blocking::Client::builder()
            .timeout(options.timeout)
            .connect_timeout(options.timeout)
            // No redirects: `activate` posts an email and a licence key, and a
            // 30x that replayed them somewhere else would be a leak.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| ConfigError::TransportUnavailable)?;

        Ok(Self {
            http,
            base,
            activate_url,
            revalidate_url,
            options,
            clock: Box::new(clock),
        })
    }

    /// Construct from a raw value, or return `None` when there is none.
    ///
    /// Split from [`LiveLicenseApiClient::from_env`] - which does not exist;
    /// the environment is read once in [`production_client`] - so the "no
    /// endpoint configured" path is testable without mutating process-wide
    /// environment variables, which tests running in parallel would race over.
    fn configured(raw: Option<&str>, clock: impl Clock + Send + Sync + 'static) -> Option<Self> {
        let raw = raw.map(str::trim).filter(|value| !value.is_empty())?;
        match Self::new(raw, clock) {
            Ok(client) => Some(client),
            Err(error) => {
                // Refused loudly rather than silently falling back: an operator
                // who set the variable and got the placeholder with no message
                // would have no way to know why activation still says network
                // error.
                log::error!("ignoring {BASE_URL_ENV}: {error}");
                None
            }
        }
    }
}

impl LicenseApiClient for LiveLicenseApiClient {
    /// First activation: `POST` the request and translate the answer.
    ///
    /// Exactly one attempt, by design. See [`Options::retry_budget`].
    fn activate(&self, request: &ActivationRequest) -> ActivationOutcome {
        let body = match serde_json::to_string(request) {
            Ok(body) => body,
            Err(error) => {
                log::warn!("activation request could not be encoded: {error}");
                return ActivationOutcome::Refused(FailureKind::NetworkError);
            }
        };
        self.post(&self.activate_url, &body, BindingOutcome::FirstActivation, false)
    }

    /// Read-only revalidation of a stored token.
    ///
    /// The stored token travels in the body rather than as a bearer header.
    /// How `revalidate` authenticates is **unknown - not specified in code**
    /// (`API_CONTRACT_ACTIVATION.md` §12 item 3), so this picks the one scheme
    /// that invents no new header: the two fields the trait already passes.
    /// Revisit when the server route is written.
    fn revalidate(&self, device_token: &str, device_fingerprint: &str) -> ActivationOutcome {
        let payload = WireRevalidate {
            device_token,
            device_fingerprint,
        };
        let body = match serde_json::to_string(&payload) {
            Ok(body) => body,
            Err(error) => {
                log::warn!("revalidation request could not be encoded: {error}");
                return ActivationOutcome::Refused(FailureKind::NetworkError);
            }
        };
        self.post(
            &self.revalidate_url,
            &body,
            BindingOutcome::AuthorizedDeviceRevalidation,
            true,
        )
    }

    /// Could the licensing service be spoken to at all?
    ///
    /// Any HTTP answer counts as reachable, including a `404`: this asks
    /// "is anything there", not "did it agree". It never inspects a stored
    /// token and never softens a verdict [`LicenseApiClient::revalidate`] gave.
    ///
    /// One attempt and no retries. This is the question asked when the network
    /// is already suspect, and making an operator wait through a retry budget
    /// before showing the network-error notice is the wrong trade.
    fn reachability(&self) -> Reachability {
        match self.http.get(self.base.clone()).timeout(self.options.timeout).send() {
            Ok(_) => Reachability::Reachable,
            Err(error) => {
                log::warn!("licence service unreachable: {}", describe_transport(&error));
                Reachability::Unreachable
            }
        }
    }
}

impl LiveLicenseApiClient {
    /// One POST, repeated only while it is safe and the clock still allows it.
    fn post(
        &self,
        url: &reqwest::Url,
        json: &str,
        binding: BindingOutcome,
        repeatable: bool,
    ) -> ActivationOutcome {
        // The deadline is read once, from the injected clock. Nothing sleeps on
        // it; it only decides whether another attempt is still inside budget.
        let deadline = self.clock.now_unix().saturating_add(self.options.budget_secs);
        let mut attempts_left: u8 = if repeatable {
            self.options.retry_budget
        } else {
            0
        };

        loop {
            let answer = self.once(url, json);

            if is_retryable(&answer)
                && attempts_left > 0
                && self.clock.now_unix() < deadline
            {
                attempts_left -= 1;
                // Path and status only. The body and the payload are never
                // logged: both can carry an email, a licence key or a token.
                log::warn!(
                    "licence call to {} failed; {} attempt(s) left inside budget",
                    url.path(),
                    attempts_left
                );
                continue;
            }

            return match answer {
                Answer::Http { status, body } => decode(status, &body, binding),
                Answer::Transport { stage, error } => {
                    log::warn!(
                        "licence call to {} failed at {stage}: {error}",
                        url.path()
                    );
                    ActivationOutcome::Refused(FailureKind::NetworkError)
                }
            };
        }
    }

    /// A single attempt, with no judgement about what the answer means.
    fn once(&self, url: &reqwest::Url, json: &str) -> Answer {
        let sent = self
            .http
            .post(url.clone())
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(json.to_string())
            .timeout(self.options.timeout)
            .send();

        match sent {
            Ok(response) => {
                let status = response.status().as_u16();
                match response.text() {
                    Ok(body) => Answer::Http { status, body },
                    Err(error) => Answer::Transport {
                        stage: "reading the response body",
                        error: describe_transport(&error),
                    },
                }
            }
            Err(error) => Answer::Transport {
                stage: "sending the request",
                error: describe_transport(&error),
            },
        }
    }
}

/// What one attempt came back with, before it means anything.
enum Answer {
    Http {
        status: u16,
        body: String,
    },
    Transport {
        stage: &'static str,
        error: String,
    },
}

/// Worth another attempt: nothing arrived, or the server said "try later".
///
/// A `4xx` other than `429` is a considered answer, not a hiccup, so retrying
/// it would only repeat a verdict we already have. `409` is never retried for
/// the same reason - it is already [`FailureKind::AlreadyBoundToAnotherComputer`].
fn is_retryable(answer: &Answer) -> bool {
    match answer {
        Answer::Transport { .. } => true,
        Answer::Http { status, .. } => *status >= 500 || *status == 429,
    }
}

/// Human-readable transport detail for a log line. Never the URL.
fn describe_transport(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "timed out".to_string()
    } else if error.is_connect() {
        "could not connect".to_string()
    } else if error.is_decode() {
        "response was not readable".to_string()
    } else if error.is_redirect() {
        "refused a redirect".to_string()
    } else {
        // The `Display` impl of a reqwest error carries the underlying cause
        // and a redacted URL; it does not carry the request body.
        format!("{error}")
    }
}

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/// Wire shapes: the request this client sends and the two answers it accepts.
///
/// ---

/// The revalidation body: the two values the trait already passes, and
/// nothing else.
#[derive(Debug, Serialize, Deserialize)]
struct WireRevalidate<'a> {
    device_token: &'a str,
    device_fingerprint: &'a str,
}

/// The success shape, read leniently where the existing code says leniency is
/// the honest choice.
///
/// `binding` is optional because the call site already decides it: `activate`
/// is a first binding and `revalidate` is a revalidation, exactly as
/// `fake.rs:120,133` does. A server that sends it is believed; one that does
/// not changes nothing.
///
/// `grace_expires_at_unix` defaults to `0` on purpose, not leniently.
/// `api.rs:113-115` documents `0` as "deliberately meaningless rather than no
/// limit" - it decodes to 1970, which is past, so a server that omits the
/// deadline refuses instead of granting forever.
#[derive(Debug, Deserialize)]
struct WireSuccess {
    device_token: String,
    entitlement: SignedSnapshot,
    offline_lease: SignedSnapshot,
    server_time: String,
    #[serde(default)]
    grace_expires_at_unix: u64,
    #[serde(default)]
    binding: Option<BindingOutcome>,
}

impl WireSuccess {
    fn into_success(self, fallback: BindingOutcome) -> ActivationSuccess {
        ActivationSuccess {
            device_token: self.device_token,
            entitlement: self.entitlement,
            offline_lease: self.offline_lease,
            server_time: self.server_time,
            grace_expires_at_unix: self.grace_expires_at_unix,
            binding: self.binding.unwrap_or(fallback),
        }
    }
}

/// The error shape: a flat `code`, or a `code` nested under `error`.
#[derive(Debug, Deserialize)]
struct WireFailure {
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    error: Option<WireFailureBody>,
}

#[derive(Debug, Deserialize)]
struct WireFailureBody {
    #[serde(default)]
    code: Option<String>,
}

/// Turn one HTTP answer into an outcome.
///
/// Order matters, and it is the order of confidence:
///
/// 1. `409 Conflict` carries its own meaning. It is checked before the body so
///    that a server which answers `409` with no body - the common case - still
///    reports `already bound to another computer` rather than `network error`.
/// 2. A `2xx` is read as a success first, because that is what a `2xx` is for.
/// 3. Anything else is read as a verdict only if it carries one of our six
///    codes; otherwise it is `NetworkError`.
///
/// Total for every input: no `status` and no `body` can produce an outcome
/// outside the six, and none can panic. That is what the property test in this
/// module pins.
fn decode(status: u16, body: &str, binding: BindingOutcome) -> ActivationOutcome {
    if status == 409 {
        if failure_from_body(body).is_some_and(|found| {
            found != FailureKind::AlreadyBoundToAnotherComputer
        }) {
            log::warn!("409 Conflict carried a disagreeing verdict; reporting already bound");
        }
        return ActivationOutcome::Refused(FailureKind::AlreadyBoundToAnotherComputer);
    }

    if (200..300).contains(&status) {
        match serde_json::from_str::<WireSuccess>(body) {
            Ok(success) => return ActivationOutcome::Success(success.into_success(binding)),
            Err(_) => {
                if let Some(failure) = failure_from_body(body) {
                    return ActivationOutcome::Refused(failure);
                }
                // A `2xx` that is neither shape. Quote the status and the
                // length, never the body: it may be a customer record.
                log::warn!("unexpected {status} answer of {} bytes", body.len());
                return ActivationOutcome::Refused(FailureKind::NetworkError);
            }
        }
    }

    match failure_from_body(body) {
        Some(failure) => ActivationOutcome::Refused(failure),
        None => {
            if !body.is_empty() {
                log::warn!("{status} answer carried no recognised verdict");
            }
            ActivationOutcome::Refused(FailureKind::NetworkError)
        }
    }
}

/// Pull a verdict out of an error body, if it carries one we recognise.
///
/// An unrecognised code is logged and reported as *no verdict*, so the caller
/// falls through to `NetworkError`. It is deliberately not mapped to
/// `InvalidLicence`: telling an operator their licence is invalid because the
/// server sent a verdict this build has never heard of would be inventing an
/// accusation. `api.rs:31-34` already assigns untranslatable answers to
/// `NetworkError`.
fn failure_from_body(body: &str) -> Option<FailureKind> {
    let envelope = serde_json::from_str::<WireFailure>(body).ok()?;
    let code = envelope.code.or_else(|| envelope.error?.code)?;
    match failure_from_code(&code) {
        Some(failure) => Some(failure),
        None => {
            log::warn!("server sent an unrecognised verdict code; reporting network error");
            None
        }
    }
}

/// Map one of our six codes back to its verdict.
///
/// Case- and whitespace-insensitive so `already_bound` and `ALREADY_BOUND ` are
/// the same answer. Returns `None` for anything else - there is no seventh
/// option, which is the whole point of the six-string rule.
fn failure_from_code(code: &str) -> Option<FailureKind> {
    let wanted = code.trim().trim_matches('"').to_ascii_uppercase();
    if wanted.is_empty() {
        return None;
    }
    FailureKind::ALL
        .into_iter()
        .find(|failure| failure.code() == wanted)
}

// ---------------------------------------------------------------------------
// Construction from configuration
// ---------------------------------------------------------------------------

/// Parse and validate a configured base URL.
///
/// Rejects credentials outright rather than stripping them: silently removing
/// a password from a URL would leave the operator believing they had configured
/// something they had not.
fn parse_base(raw: &str) -> Result<reqwest::Url, ConfigError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ConfigError::UnparsableUrl);
    }

    let url = reqwest::Url::parse(trimmed).map_err(|_| ConfigError::UnparsableUrl)?;
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err(ConfigError::UnsupportedScheme),
    }
    if url.host_str().is_none() {
        return Err(ConfigError::MissingHost);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ConfigError::CredentialInUrl);
    }
    Ok(url)
}

/// Make `base` end in `/` so `join` appends rather than replacing its last
/// segment: `https://host/api` must resolve to `https://host/api/v1/activation`,
/// never `https://host/v1/activation`.
fn normalise_base(base: &mut reqwest::Url) {
    if !base.path().ends_with('/') {
        let path = format!("{}/", base.path());
        base.set_path(&path);
    }
    // A query or fragment on a base URL has no meaning for the calls below and
    // `join` would drop it anyway; dropping it here keeps the two in step.
    base.set_query(None);
    base.set_fragment(None);
}

// ---------------------------------------------------------------------------
// The production selection
// ---------------------------------------------------------------------------

/// The client production uses: the live one if an endpoint is configured, and
/// the placeholder otherwise.
///
/// Resolved once and cached, because building an HTTP client per command would
/// rebuild its connection pool - and thread - every time. The first resolution
/// is expected on the main thread during startup, before any async runtime
/// exists, which is the one context where constructing a blocking HTTP client
/// is unambiguously safe.
///
/// Unconfigured is the shipped state, and it is the state that cannot say yes.
pub fn production_client() -> &'static dyn LicenseApiClient {
    static RESOLVED: OnceLock<Option<LiveLicenseApiClient>> = OnceLock::new();
    static PLACEHOLDER: PlaceholderLicenseApiClient = PlaceholderLicenseApiClient;

    let resolved = RESOLVED.get_or_init(|| {
        let raw = std::env::var(BASE_URL_ENV).ok();
        LiveLicenseApiClient::configured(raw.as_deref(), SystemClock)
    });

    match resolved {
        Some(live) => live,
        None => &PLACEHOLDER,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ledger::FixedClock;
    use proptest::prelude::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// Production runs every decision on `spawn_blocking` (`commands.rs:106`),
    /// so the tests run there too. This is not only fidelity: a blocking HTTP
    /// client must not be constructed or called from inside the async runtime,
    /// and this is the shape that proves it never is.
    async fn on_blocking_thread<F, R>(work: F) -> R
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        tokio::task::spawn_blocking(work)
            .await
            .expect("the licence client must never panic")
    }

    fn base_url(server: &MockServer) -> String {
        format!("http://{}", server.address())
    }

    fn options() -> Options {
        Options::default()
    }

    /// A clock that does not move. Budget therefore never expires, which is
    /// what every test wants except the one proving the clock matters.
    fn still_clock() -> FixedClock {
        FixedClock::new(1_790_762_400)
    }

    /// A clock whose every reading moves it forward by `jump`.
    ///
    /// Only a test needs this: production never advances a clock
    /// (`ledger.rs:88-90` gates `FixedClock::advance` behind `cfg(test)` for
    /// exactly that reason). It exists to prove the retry budget is bounded by
    /// the *injected* clock and not by anything measuring real seconds.
    struct JumpClock {
        now: AtomicU64,
        jump: u64,
    }

    impl JumpClock {
        fn new(start: u64, jump: u64) -> Self {
            Self {
                now: AtomicU64::new(start),
                jump,
            }
        }
    }

    impl Clock for JumpClock {
        fn now_unix(&self) -> u64 {
            self.now.fetch_add(self.jump, Ordering::Relaxed)
        }
    }

    fn request() -> ActivationRequest {
        ActivationRequest {
            email: "fixture@local.invalid".to_string(),
            licence_key: "CYVRA-TEST-KEY".to_string(),
            terms_version: "V1.0-DRAFT".to_string(),
            app_version: "0.1.0".to_string(),
            device_fingerprint: "92a0cf07c6fd2ba9".to_string(),
        }
    }

    /// A complete, valid success body.
    fn granted_body() -> String {
        serde_json::json!({
            "device_token": "server-issued-token",
            "entitlement": {
                "payload": "{\"licenseId\":\"LIC-MOB-2026-00124\"}",
                "signature": "ZW50aXRsZW1lbnQ"
            },
            "offline_lease": {
                "payload": "{\"lease\":true}",
                "signature": "bGVhc2U"
            },
            "server_time": "2026-09-30T10:00:00Z",
            "grace_expires_at_unix": 1_790_848_800u64,
            "binding": "FirstActivation"
        })
        .to_string()
    }

    // -- decoding: pure, no socket ------------------------------------------

    #[test]
    fn each_of_the_six_codes_maps_back_to_itself() {
        for failure in [
            FailureKind::InvalidUser,
            FailureKind::InvalidLicence,
            FailureKind::LicenceNotActive,
            FailureKind::LicenceExpired,
            FailureKind::AlreadyBoundToAnotherComputer,
            FailureKind::NetworkError,
        ] {
            assert_eq!(failure_from_code(failure.code()), Some(failure));
            // Case and padding are not allowed to change the answer.
            let noisy = format!("  {}  ", failure.code().to_lowercase());
            assert_eq!(failure_from_code(&noisy), Some(failure));
        }
    }

    #[test]
    fn a_code_that_is_not_ours_is_no_verdict_at_all() {
        // The server may invent codes we have never heard of. Mapping one to a
        // licence verdict would be an accusation we cannot support.
        for code in ["PLAN_SUSPENDED", "W1_5", "", "  ", "INVALID-USERS"] {
            assert_eq!(failure_from_code(code), None, "code: {code:?}");
        }
    }

    #[test]
    fn a_conflict_is_already_bound_whatever_the_body_says() {
        for body in [
            "",
            "not json at all",
            r#"{"code":"INVALID_USER"}"#,
            r#"{"error":{"code":"LICENCE_EXPIRED"}}"#,
        ] {
            assert_eq!(
                decode(409, body, BindingOutcome::FirstActivation),
                ActivationOutcome::Refused(FailureKind::AlreadyBoundToAnotherComputer),
                "body: {body:?}"
            );
        }
    }

    #[test]
    fn an_answer_that_is_neither_shape_never_approves() {
        for (status, body) in [
            (200, "{"),
            (200, ""),
            (200, r#"{"device_token":"only-a-token"}"#),
            (500, "internal server error"),
            (503, ""),
            (404, "not found"),
        ] {
            assert!(
                matches!(
                    decode(status, body, BindingOutcome::FirstActivation),
                    ActivationOutcome::Refused(_)
                ),
                "{status} / {body:?} must not approve"
            );
        }
    }

    #[test]
    fn a_missing_grace_deadline_refuses_rather_than_granting_forever() {
        // `api.rs:113-115` makes `0` mean "already past", so a server that
        // omits the deadline cannot accidentally grant unlimited time.
        let body = r#"{
            "device_token":"t",
            "entitlement":{"payload":"p","signature":"s"},
            "offline_lease":{"payload":"p","signature":"s"},
            "server_time":"2026-09-30T10:00:00Z"
        }"#;
        let ActivationOutcome::Success(success) =
            decode(200, body, BindingOutcome::AuthorizedDeviceRevalidation)
        else {
            panic!("an otherwise complete success should still decode");
        };
        assert_eq!(success.grace_expires_at_unix, 0);
        // The call site decides the binding when the server does not.
        assert_eq!(success.binding, BindingOutcome::AuthorizedDeviceRevalidation);
    }

    #[test]
    fn an_empty_binding_is_not_let_through_as_a_first_binding_by_accident() {
        // An explicit value always wins over the call-site default.
        let body = granted_body().replace(
            r#""binding":"FirstActivation""#,
            r#""binding":"AuthorizedDeviceRevalidation""#,
        );
        let ActivationOutcome::Success(success) =
            decode(200, &body, BindingOutcome::FirstActivation)
        else {
            panic!("expected a grant");
        };
        assert_eq!(success.binding, BindingOutcome::AuthorizedDeviceRevalidation);
    }

    // -- configuration ------------------------------------------------------

    #[test]
    fn credentials_in_a_url_are_refused_not_stripped() {
        for raw in [
            "https://user:secret@example.com/",
            "https://user@example.com/",
            "ftp://example.com/",
            "not a url",
            "",
            "   ",
        ] {
            assert!(
                LiveLicenseApiClient::new(raw, still_clock()).is_err(),
                "should have refused {raw:?}"
            );
        }
    }

    #[test]
    fn a_base_without_a_trailing_slash_still_appends_the_path() {
        let client =
            LiveLicenseApiClient::with_options("https://example.com/api", options(), still_clock())
                .expect("valid endpoint");
        assert_eq!(
            client.activate_url.as_str(),
            "https://example.com/api/v1/activation"
        );
    }

    #[test]
    fn no_configured_endpoint_means_no_live_client() {
        // The shipped default: nothing set, nothing built, placeholder stays.
        assert!(LiveLicenseApiClient::configured(None, still_clock()).is_none());
        assert!(LiveLicenseApiClient::configured(Some("   "), still_clock()).is_none());
        assert!(
            LiveLicenseApiClient::configured(Some("not a url at all"), still_clock()).is_none()
        );
    }

    #[test]
    fn a_configured_endpoint_is_built_once_and_reused() {
        let live = LiveLicenseApiClient::configured(Some("https://example.com/"), still_clock())
            .expect("a valid endpoint should build");
        assert_eq!(live.base.as_str(), "https://example.com/");
        // Proves the resolved object is what production would hand out: the
        // placeholder is only reached when this returns `None`.
        assert!(!format!("{live:?}").is_empty());
    }

    // -- properties ---------------------------------------------------------

    proptest! {
        /// The invariant the whole six-string rule rests on: no status and no
        /// body, however hostile, can produce a verdict outside the six, and
        /// none can panic.
        #[test]
        fn any_answer_collapses_into_the_six(status: u16, body in any::<String>()) {
            let outcome = decode(status, &body, BindingOutcome::FirstActivation);
            if let ActivationOutcome::Refused(failure) = outcome {
                let allowed = [
                    "invalid user", "invalid licence", "licence not active",
                    "licence expired", "already bound to another computer", "network error",
                ];
                prop_assert!(allowed.contains(&failure.as_str()));
            }
        }

        /// An arbitrary string is either one of our six codes or no verdict;
        /// it is never something in between.
        #[test]
        fn an_arbitrary_code_is_never_a_seventh_verdict(code in any::<String>()) {
            if let Some(failure) = failure_from_code(&code) {
                prop_assert!(FailureKind::ALL.contains(&failure));
            }
        }

        /// `409` means one thing regardless of what rides along with it.
        #[test]
        fn conflict_is_always_already_bound(body in any::<String>()) {
            prop_assert_eq!(
                decode(409, &body, BindingOutcome::FirstActivation),
                ActivationOutcome::Refused(FailureKind::AlreadyBoundToAnotherComputer)
            );
        }
    }

    // -- over a socket ------------------------------------------------------

    #[tokio::test]
    async fn a_granted_activation_round_trips_exactly_what_the_server_sent() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/activation"))
            .respond_with(ResponseTemplate::new(200).set_body_string(granted_body()))
            .expect(1)
            .mount(&server)
            .await;

        let url = base_url(&server);
        let outcome = on_blocking_thread(move || {
            let client = LiveLicenseApiClient::new(&url, still_clock()).expect("endpoint");
            client.activate(&request())
        })
        .await;

        let ActivationOutcome::Success(success) = outcome else {
            panic!("expected a grant, got {outcome:?}");
        };
        assert_eq!(success.device_token, "server-issued-token");
        assert_eq!(success.server_time, "2026-09-30T10:00:00Z");
        assert_eq!(success.grace_expires_at_unix, 1_790_848_800);
        assert_eq!(success.binding, BindingOutcome::FirstActivation);
        // Both signed blobs must arrive byte-for-byte: the Rust layer never
        // re-signs and never re-serialises them (api.rs:71-75).
        assert_eq!(success.entitlement.signature, "ZW50aXRsZW1lbnQ");
        assert_eq!(success.offline_lease.signature, "bGVhc2U");

        server.verify().await;
    }

    #[tokio::test]
    async fn the_request_body_is_the_declared_json_shape() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/activation"))
            .respond_with(ResponseTemplate::new(200).set_body_string(granted_body()))
            .mount(&server)
            .await;

        let url = base_url(&server);
        on_blocking_thread(move || {
            let client = LiveLicenseApiClient::new(&url, still_clock()).expect("endpoint");
            client.activate(&request())
        })
        .await;

        let sent = server.received_requests().await.unwrap_or_default();
        assert_eq!(sent.len(), 1);

        let parsed: serde_json::Value =
            serde_json::from_slice(&sent[0].body).expect("the body should be JSON");
        // The derives' own names - no renaming layer, no second schema.
        assert_eq!(parsed["email"], "fixture@local.invalid");
        assert_eq!(parsed["licence_key"], "CYVRA-TEST-KEY");
        assert_eq!(parsed["terms_version"], "V1.0-DRAFT");
        assert_eq!(parsed["app_version"], "0.1.0");
        assert_eq!(parsed["device_fingerprint"], "92a0cf07c6fd2ba9");
        assert_eq!(
            sent[0]
                .headers
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("application/json")
        );
    }

    #[tokio::test]
    async fn a_revalidation_carries_the_stored_token_and_is_a_revalidation() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/activation/revalidate"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                granted_body().replace(r#""binding":"FirstActivation""#, r#""binding":"AuthorizedDeviceRevalidation""#),
            ))
            .expect(1)
            .mount(&server)
            .await;

        let url = base_url(&server);
        let outcome = on_blocking_thread(move || {
            let client = LiveLicenseApiClient::new(&url, still_clock()).expect("endpoint");
            client.revalidate("stored-device-token", "92a0cf07c6fd2ba9")
        })
        .await;

        let ActivationOutcome::Success(success) = outcome else {
            panic!("expected a grant, got {outcome:?}");
        };
        assert_eq!(success.binding, BindingOutcome::AuthorizedDeviceRevalidation);

        let sent = server.received_requests().await.unwrap_or_default();
        let parsed: serde_json::Value =
            serde_json::from_slice(&sent[0].body).expect("the body should be JSON");
        assert_eq!(parsed["device_token"], "stored-device-token");
        assert_eq!(parsed["device_fingerprint"], "92a0cf07c6fd2ba9");

        server.verify().await;
    }

    #[tokio::test]
    async fn every_server_code_is_reported_as_that_verdict() {
        // One socket test per code, because the mapping has to hold over the
        // wire and not only in the pure decoder above.
        for failure in [
            FailureKind::InvalidUser,
            FailureKind::InvalidLicence,
            FailureKind::LicenceNotActive,
            FailureKind::LicenceExpired,
            FailureKind::AlreadyBoundToAnotherComputer,
            FailureKind::NetworkError,
        ] {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/v1/activation"))
                .respond_with(ResponseTemplate::new(403).set_body_string(
                    serde_json::json!({ "code": failure.code(), "message": "declined" }).to_string(),
                ))
                .mount(&server)
                .await;

            let url = base_url(&server);
            let outcome = on_blocking_thread(move || {
                let client = LiveLicenseApiClient::new(&url, still_clock()).expect("endpoint");
                client.activate(&request())
            })
            .await;

            assert_eq!(
                outcome,
                ActivationOutcome::Refused(failure),
                "code {} came back wrong",
                failure.code()
            );
        }
    }

    #[tokio::test]
    async fn a_conflict_with_no_body_is_still_already_bound() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/activation/revalidate"))
            .respond_with(ResponseTemplate::new(409))
            .expect(1)
            .mount(&server)
            .await;

        let url = base_url(&server);
        let outcome = on_blocking_thread(move || {
            let client = LiveLicenseApiClient::new(&url, still_clock()).expect("endpoint");
            client.revalidate("stored-device-token", "92a0cf07c6fd2ba9")
        })
        .await;

        assert_eq!(
            outcome,
            ActivationOutcome::Refused(FailureKind::AlreadyBoundToAnotherComputer)
        );
        server.verify().await;
    }

    #[tokio::test]
    async fn an_unrecognised_code_is_reported_as_a_network_error_not_a_verdict() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/activation"))
            .respond_with(
                ResponseTemplate::new(402)
                    .set_body_string(r#"{"code":"PLAN_SUSPENDED","message":"pay us"}"#),
            )
            .mount(&server)
            .await;

        let url = base_url(&server);
        let outcome = on_blocking_thread(move || {
            let client = LiveLicenseApiClient::new(&url, still_clock()).expect("endpoint");
            client.activate(&request())
        })
        .await;

        assert_eq!(
            outcome,
            ActivationOutcome::Refused(FailureKind::NetworkError)
        );
    }

    #[tokio::test]
    async fn a_redirect_is_refused_rather_than_replaying_the_licence_key() {
        // A `POST` carrying an email and a licence key must not follow a `3xx`
        // to wherever it points.
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/activation"))
            .respond_with(ResponseTemplate::new(307).insert_header("location", "/elsewhere"))
            .mount(&server)
            .await;

        let url = base_url(&server);
        let outcome = on_blocking_thread(move || {
            let client = LiveLicenseApiClient::new(&url, still_clock()).expect("endpoint");
            client.activate(&request())
        })
        .await;

        assert_eq!(
            outcome,
            ActivationOutcome::Refused(FailureKind::NetworkError)
        );
        assert_eq!(
            server.received_requests().await.unwrap_or_default().len(),
            1,
            "the redirect must not be followed"
        );
    }

    #[tokio::test]
    async fn an_unreachable_service_is_a_network_error() {
        // Bind, take the port, release it: a listener nobody answers on.
        let address = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("ephemeral port");
            listener.local_addr().expect("an address")
        };

        let url = format!("http://{address}");
        let outcome = on_blocking_thread(move || {
            let client = LiveLicenseApiClient::new(&url, still_clock()).expect("endpoint");
            client.activate(&request())
        })
        .await;

        assert_eq!(
            outcome,
            ActivationOutcome::Refused(FailureKind::NetworkError)
        );
    }

    #[tokio::test]
    async fn reachability_tells_a_live_service_from_a_dead_one() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let live_url = base_url(&server);

        // Port 1: nothing listens there.
        let dead_url = "http://127.0.0.1:1/".to_string();

        let (reachable, unreachable) = on_blocking_thread(move || {
            let live = LiveLicenseApiClient::new(&live_url, still_clock()).expect("endpoint");
            let dead = LiveLicenseApiClient::new(&dead_url, still_clock()).expect("endpoint");
            (live.reachability(), dead.reachability())
        })
        .await;

        // A `404` is still an answer: this asks whether anything is there.
        assert_eq!(reachable, Reachability::Reachable);
        assert_eq!(unreachable, Reachability::Unreachable);
    }

    #[tokio::test]
    async fn a_first_binding_is_never_retried() {
        // A repeated binding would be a second binding, so `activate` gets one
        // attempt even though the options allow two retries.
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/activation"))
            .respond_with(ResponseTemplate::new(500))
            .expect(1)
            .mount(&server)
            .await;

        let url = base_url(&server);
        let outcome = on_blocking_thread(move || {
            let client = LiveLicenseApiClient::new(&url, still_clock()).expect("endpoint");
            client.activate(&request())
        })
        .await;

        assert_eq!(
            outcome,
            ActivationOutcome::Refused(FailureKind::NetworkError)
        );
        server.verify().await;
    }

    #[tokio::test]
    async fn a_read_only_revalidation_is_retried_within_its_budget() {
        // 1 attempt + 2 retries, then the verdict is reported as it stands.
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/activation/revalidate"))
            .respond_with(ResponseTemplate::new(503))
            .expect(3)
            .mount(&server)
            .await;

        let url = base_url(&server);
        let outcome = on_blocking_thread(move || {
            let client = LiveLicenseApiClient::new(&url, still_clock()).expect("endpoint");
            client.revalidate("stored-device-token", "92a0cf07c6fd2ba9")
        })
        .await;

        assert_eq!(
            outcome,
            ActivationOutcome::Refused(FailureKind::NetworkError)
        );
        server.verify().await;
    }

    #[tokio::test]
    async fn the_injected_clock_is_what_stops_the_retries() {
        // Same budget, same server, same client options - the only difference
        // is which clock is injected, and that alone decides whether the call
        // stops after one attempt or after three. If the budget were measured
        // on real seconds, both of these would behave identically.
        let still_server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/activation/revalidate"))
            .respond_with(ResponseTemplate::new(503))
            .expect(3)
            .mount(&still_server)
            .await;

        let moving_server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/activation/revalidate"))
            .respond_with(ResponseTemplate::new(503))
            .expect(1)
            .mount(&moving_server)
            .await;

        let still_url = base_url(&still_server);
        let moving_url = base_url(&moving_server);

        let (still_answer, moving_answer) = on_blocking_thread(move || {
            let opts = Options {
                budget_secs: 100,
                ..Options::default()
            };
            let still = LiveLicenseApiClient::with_options(
                &still_url,
                opts.clone(),
                FixedClock::new(1_790_762_400),
            )
            .expect("endpoint");
            let moving = LiveLicenseApiClient::with_options(
                &moving_url,
                opts,
                JumpClock::new(1_790_762_400, 5_000),
            )
            .expect("endpoint");

            let still_answer = still.revalidate("stored-device-token", "92a0cf07c6fd2ba9");
            let moving_answer = moving.revalidate("stored-device-token", "92a0cf07c6fd2ba9");
            (still_answer, moving_answer)
        })
        .await;

        // Identical verdicts - both exhausted into `network error`...
        assert_eq!(still_answer, ActivationOutcome::Refused(FailureKind::NetworkError));
        assert_eq!(
            moving_answer,
            ActivationOutcome::Refused(FailureKind::NetworkError)
        );
        // ...but the still clock spent its whole budget, three attempts
        // (`expect(3)`), and the jumping clock saw its deadline pass after the
        // first, one attempt (`expect(1)`). Same budget, different injected
        // clock, different number of attempts.
        still_server.verify().await;
        moving_server.verify().await;
    }

    #[tokio::test]
    async fn a_configured_environment_variable_makes_production_post_for_real() {
        // The exit criterion for this task, proved end to end rather than by
        // reading the wiring: the variable is set, `production_client` picks
        // the live transport over the placeholder, and a real HTTP `POST`
        // leaves the process and is caught by a server that is not the fake in
        // `fake.rs`.
        //
        // This is the only test that claims `production_client`'s process-wide
        // `OnceLock`, and it must stay that way: whichever test calls it first
        // fixes the mode for the whole binary. No other code in this crate
        // reads `BASE_URL_ENV`.
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/activation"))
            .respond_with(ResponseTemplate::new(403).set_body_string(
                serde_json::json!({ "code": "INVALID_LICENCE", "message": "no" }).to_string(),
            ))
            .expect(1)
            .mount(&server)
            .await;

        std::env::set_var(BASE_URL_ENV, base_url(&server));

        // Called on a blocking thread because that is where the commands call
        // it (`commands.rs:106`), and because a blocking HTTP client must not
        // be built inside the async runtime.
        let outcome = on_blocking_thread(|| {
            let client = production_client();
            client.activate(&request())
        })
        .await;

        std::env::remove_var(BASE_URL_ENV);

        // Not `NetworkError` from a client that never dialled: the server
        // answered, and its verdict came back through the mapping.
        assert_eq!(
            outcome,
            ActivationOutcome::Refused(FailureKind::InvalidLicence)
        );

        let sent = server.received_requests().await.unwrap_or_default();
        assert_eq!(
            sent.len(),
            1,
            "production made no HTTP call - the placeholder is still wired"
        );
        let parsed: serde_json::Value =
            serde_json::from_slice(&sent[0].body).expect("the body should be JSON");
        assert_eq!(parsed["email"], "fixture@local.invalid");

        server.verify().await;
    }

    #[tokio::test]
    async fn an_endpoint_that_cannot_be_built_never_reaches_an_operator() {
        // A bad configuration must fail at construction, not on the first
        // attempt with a confusing verdict.
        let outcome = LiveLicenseApiClient::new("https://user:pw@example.com/", still_clock());
        assert_eq!(outcome.err(), Some(ConfigError::CredentialInUrl));
    }

    #[tokio::test]
    async fn a_timeout_is_a_network_error_not_a_panic() {
        // A server that never answers. `expect(1)` keeps it to one attempt.
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/activation"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(2)))
            .mount(&server)
            .await;

        let url = base_url(&server);
        let outcome = on_blocking_thread(move || {
            let opts = Options {
                timeout: Duration::from_millis(250),
                retry_budget: 0,
                ..Options::default()
            };
            let client =
                LiveLicenseApiClient::with_options(&url, opts, still_clock()).expect("endpoint");
            client.activate(&request())
        })
        .await;

        assert_eq!(
            outcome,
            ActivationOutcome::Refused(FailureKind::NetworkError)
        );
    }
}
