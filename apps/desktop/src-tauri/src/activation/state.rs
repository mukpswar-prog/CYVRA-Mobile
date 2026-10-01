//! The launch sequence: everything between the process starting and the
//! existing application appearing.
//!
//! ```text
//!                       +------------------+
//!                       |  process start   |
//!                       +---------+--------+
//!                                 |
//!                       +---------v---------+
//!  +--------------------+  activation store  +---------------------+
//!  |                    +---+-----------+----+                     |
//!  |                absent|           |present                     |
//!  |            +---------v--+   +----v-------------------+        |
//!  |            | reachable? |   | silent revalidation of |        |
//!  |            +---+-----+--+   | the stored token       |        |
//!  |           no |     |yes     +---+-------+-------+----+        |
//!  |     +--------v+  +-v---------+ ok|       |refused |           |
//!  |     | network |  | activation|   |       |        |           |
//!  |     |  error  |  |  screen   |   |       |        |           |
//!  |     +---------+  +-----------+   |       |        |           |
//!  |                                 |       |        |           |
//!  |             +-------------------v-+   +-v--------v-------+   |
//!  |             | ENTER (online)      |   | one of the six   |   |
//!  |             | ENTER (offline,     |   | verdicts, on the  |   |
//!  |             |   within grace)     |   | activation screen |   |
//!  |             +---------------------+   +-------------------+   |
//!  |                                                               |
//!  +-- anything unreadable or unexportable => activation screen    |
//!      with NO banner: a damaged local file is not a licence        |
//!      verdict, and inventing a seventh sentence would be a lie.    |
//! ```
//!
//! Three rules hold all the way through:
//!
//! * **A verdict is never softened.** If the server said `licence expired`, the
//!   operator sees `licence expired` - even though a cached token exists, and
//!   even though the workstation could plausibly keep running.
//! * **An absence is never inflated.** "Never activated" and "the stored
//!   activation cannot be trusted" both lead to the same screen but are
//!   different audit events, so a corrupt store never quietly becomes a first
//!   launch.
//! * **Grace is the server's to grant.** The offline window ends on an instant
//!   the server chose. Nothing local can extend it, and passing out of it is a
//!   refusal, not a downgrade to "diagnostics only" - the Host applies the
//!   restricted permissions while we are inside it.

use crate::activation::api::{
    ActivationOutcome, ActivationRequest, ActivationSuccess, BindingOutcome, FailureKind,
    LicenseApiClient, Reachability,
};
use crate::activation::store::{StoreError, StoredActivation};
use crate::activation::{device_fingerprint, entitlement, store, FingerprintError};
use crate::ledger::{self, FixedClock, LedgerError, LedgerEvent, LedgerRequest};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// JSON-lines audit trail, one line per launch or activation decision.
pub const AUDIT_DIR: &str = "logs";
pub const AUDIT_FILE_NAME: &str = "activation-audit.jsonl";

/// What the operator should be looking at once this returns.
///
/// Four states, and only [`Launch::Refused`] ever carries text: the six verdicts
/// are the server's to give, and no other sentence about a licence may exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Launch {
    /// This workstation has never been activated. Show the screen; there is
    /// nothing to report and nothing is wrong.
    NeedsActivation,
    /// A stored activation exists but could not be read, trusted or persisted.
    ///
    /// The activation screen is shown with **no** banner. None of the six
    /// verdicts describes a damaged file on this disk, and a local defect must
    /// not borrow the server's vocabulary. The actual cause reaches the audit
    /// trail and the caller, never the UI.
    LocalFault,
    /// Show the activation screen carrying exactly this sentence.
    Refused { failure: FailureKind },
    /// Straight into the existing application. `offline` is true only when the
    /// entry is riding the grace window, which is what the UI uses to label
    /// cached data as cached.
    Enter { offline: bool },
}

/// A decision, plus the audit line it produced and whether that line landed.
///
/// The audit result travels back to the caller rather than being swallowed: a
/// full disk must never deny a paying customer entry, but it must never be
/// silent either. The revision ledger is carried for the same reason - it is
/// an accounting record, and an accounting record that vanishes quietly is
/// worse than one that reports it could not be written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchOutcome {
    pub launch: Launch,
    /// The line written to the audit trail, or the reason it could not be.
    pub audit: Result<AuditLine, AuditError>,
    /// The ledger entry appended for this decision, or why there is none.
    pub ledger: Result<(), LedgerError>,
}

/// One line in the activation audit trail.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditLine {
    pub at_unix: u64,
    pub event: AuditEvent,
    /// A stable machine code - the refusal's audit code, or the local fault's.
    /// Never the operator-facing sentence.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// The distinction that must survive into the record: who bound this computer,
/// and when the entry was a graceful one rather than a server confirmation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuditEvent {
    /// The server bound this computer for the first time.
    FirstActivation,
    /// The server already knew this computer and confirmed it. A revalidation
    /// that arrives on the activation form still lands here - it is not a new
    /// binding, whatever the operator was typing when it happened.
    AuthorizedDeviceRevalidation,
    /// Entered on the offline grace window.
    OfflineGraceEntry,
    /// Grace ran out while the server was unreachable.
    OfflineGraceExpired,
    /// The server refused. `code` names which of the six.
    ActivationRefused,
    /// Shown the activation screen with nothing to report.
    ActivationScreenShown,
    /// Something local failed. `code` names it; the UI stays silent.
    LocalFault,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditError {
    /// `<cyvra.home>` is unset or blank, so there is nowhere to write.
    HomeUnavailable,
    WriteFailed,
}

impl std::fmt::Display for AuditError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuditError::HomeUnavailable => write!(f, "installation root unavailable"),
            AuditError::WriteFailed => write!(f, "activation audit could not be written"),
        }
    }
}

impl std::error::Error for AuditError {}

pub fn audit_path(home: &Path) -> PathBuf {
    home.join(AUDIT_DIR).join(AUDIT_FILE_NAME)
}

/// Appends one JSON line, creating `<cyvra.home>/logs` on the way.
pub fn append_audit(home: &Path, line: &AuditLine) -> Result<(), AuditError> {
    use std::io::Write;

    if home.as_os_str().is_empty() {
        return Err(AuditError::HomeUnavailable);
    }

    let mut bytes = serde_json::to_vec(line).map_err(|_| AuditError::WriteFailed)?;
    bytes.push(b'\n');

    let path = audit_path(home);
    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory).map_err(|_| AuditError::WriteFailed)?;
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|_| AuditError::WriteFailed)?;
    file.write_all(&bytes).map_err(|_| AuditError::WriteFailed)?;
    Ok(())
}

/// Current wall clock as Unix seconds.
///
/// Used only to compare against a deadline the server chose. It never grants
/// anything by itself: `0` is a moment in 1970, which is before every deadline
/// that matters, and the grace window only opens when `now` is *inside* the
/// server's window.
pub fn system_now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// Builds the request the server is asked to validate.
///
/// The fingerprint is computed here rather than handed in by the caller, so an
/// activation cannot be sent without one, and so the only thing that ever
/// leaves is the digest - never a raw machine GUID, SMBIOS serial or volume
/// serial. The fields are what the activation form collects, nothing more.
pub fn activation_request(
    email: impl Into<String>,
    licence_key: impl Into<String>,
    terms_version: impl Into<String>,
    app_version: impl Into<String>,
) -> Result<ActivationRequest, FingerprintError> {
    Ok(ActivationRequest {
        email: email.into(),
        licence_key: licence_key.into(),
        terms_version: terms_version.into(),
        app_version: app_version.into(),
        device_fingerprint: device_fingerprint()?,
    })
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/// Launch: decide whether the operator reaches the existing application.
///
/// This is the only path that decides entry. It never writes an activation
/// (nothing here is a new binding) and it never deletes one.
pub fn launch(home: &Path, api: &dyn LicenseApiClient, now_unix: u64) -> LaunchOutcome {
    if home.as_os_str().is_empty() {
        return no_home();
    }

    match store::read(home) {
        Ok(None) => never_activated(home, api, now_unix),
        Ok(Some(stored)) => revalidate_path(home, api, stored, now_unix),
        Err(error) => local_fault(home, now_unix, store_code(&error)),
    }
}

/// The activation form was submitted.
///
/// Two distinct audit events come out of one entry point: the server tells us
/// whether it bound the computer or merely recognised it, and we record which
/// it said rather than which the form implied.
pub fn activate(
    home: &Path,
    api: &dyn LicenseApiClient,
    request: &ActivationRequest,
    now_unix: u64,
) -> LaunchOutcome {
    if home.as_os_str().is_empty() {
        return no_home();
    }

    match api.activate(request) {
        ActivationOutcome::Refused(failure) => refused(home, now_unix, failure),
        ActivationOutcome::Success(success) => {
            let event = match success.binding {
                BindingOutcome::FirstActivation => AuditEvent::FirstActivation,
                BindingOutcome::AuthorizedDeviceRevalidation => {
                    AuditEvent::AuthorizedDeviceRevalidation
                }
            };
            commit(
                home,
                success,
                &request.email,
                &request.device_fingerprint,
                now_unix,
                event,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// No stored activation at all.
///
/// The one place reachability decides what the operator sees: offline with
/// nothing on file is a network problem, not an invitation to type a key that
/// cannot be checked.
fn never_activated(home: &Path, api: &dyn LicenseApiClient, now_unix: u64) -> LaunchOutcome {
    if api.reachability() == Reachability::Unreachable {
        return refused(home, now_unix, FailureKind::NetworkError);
    }
    record(
        home,
        AuditLine {
            at_unix: now_unix,
            event: AuditEvent::ActivationScreenShown,
            code: None,
        },
        Launch::NeedsActivation,
    )
}

/// A stored token exists: ask the server about it, silently.
fn revalidate_path(
    home: &Path,
    api: &dyn LicenseApiClient,
    stored: StoredActivation,
    now_unix: u64,
) -> LaunchOutcome {
    let token = stored.device_token.clone();
    let fingerprint = stored.device_fingerprint.clone();

    match api.revalidate(&token, &fingerprint) {
        // A transport failure, not a verdict. Fall through to grace.
        ActivationOutcome::Refused(FailureKind::NetworkError) => offline_path(home, stored, now_unix),
        // A real verdict from a reachable server. It stands, verbatim.
        ActivationOutcome::Refused(failure) => refused(home, now_unix, failure),
        ActivationOutcome::Success(success) => {
            // A revalidation that comes back as a *new binding* means the
            // server did not recognise the token we hold. Adopting the fresh
            // one would silently swap this computer's identity on every
            // launch, so the answer is refused and the store is left exactly
            // as it was: nothing is overwritten on a suspicious reply.
            if success.binding != BindingOutcome::AuthorizedDeviceRevalidation {
                return refused(home, now_unix, FailureKind::InvalidLicence);
            }
            commit(
                home,
                success,
                &stored.email,
                &stored.device_fingerprint,
                now_unix,
                AuditEvent::AuthorizedDeviceRevalidation,
            )
        }
    }
}

/// The server could not be reached while a token is on file.
///
/// Inside grace the operator goes straight in; outside it the window is over
/// and the entry is a refusal. The message is `network error` because that is
/// what is true - the licence has not expired, the connection has.
fn offline_path(home: &Path, stored: StoredActivation, now_unix: u64) -> LaunchOutcome {
    if now_unix > stored.grace_expires_at_unix {
        // A *refusal*, so it carries one - the same code the screen will show,
        // which is the only difference between this line and the generic
        // ACTIVATION_REFUSED one. The event stays specific because "grace ran
        // out" is not the same fact as "the server said no".
        return record(
            home,
            AuditLine {
                at_unix: now_unix,
                event: AuditEvent::OfflineGraceExpired,
                code: Some(FailureKind::NetworkError.code().to_string()),
            },
            Launch::Refused {
                failure: FailureKind::NetworkError,
            },
        );
    }

    // Hand the Host the *restricted* offline lease rather than the full
    // entitlement. If this export fails the previous file stays behind - quite
    // possibly the unrestricted one - so entering here would be handing the
    // Host permissions the server did not grant for an offline session. Refuse
    // to enter instead.
    if let Err(_) = entitlement::export(home, &stored.offline_lease, &stored.server_time) {
        return local_fault(home, now_unix, "ENTITLEMENT_EXPORT_FAILED");
    }

    record(
        home,
        AuditLine {
            at_unix: now_unix,
            event: AuditEvent::OfflineGraceEntry,
            code: None,
        },
        Launch::Enter { offline: true },
    )
}

/// Persist a confirmed success and let the operator in.
///
/// Export before persisting: the store only ever records an activation we
/// managed to hand to the Host, so a transient export failure costs one retry
/// instead of leaving a token on file that points at nothing.
fn commit(
    home: &Path,
    success: ActivationSuccess,
    email: &str,
    device_fingerprint: &str,
    now_unix: u64,
    event: AuditEvent,
) -> LaunchOutcome {
    if let Err(_) = entitlement::export(home, &success.entitlement, &success.server_time) {
        return local_fault(home, now_unix, "ENTITLEMENT_EXPORT_FAILED");
    }

    let stored = StoredActivation::from_success(
        success,
        email,
        device_fingerprint,
        iso8601(now_unix),
    );
    if let Err(error) = store::write(home, &stored) {
        return local_fault(home, now_unix, store_code(&error));
    }

    record(
        home,
        AuditLine {
            at_unix: now_unix,
            event,
            code: None,
        },
        Launch::Enter { offline: false },
    )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn refused(home: &Path, now_unix: u64, failure: FailureKind) -> LaunchOutcome {
    record(
        home,
        AuditLine {
            at_unix: now_unix,
            event: AuditEvent::ActivationRefused,
            code: Some(failure.code().to_string()),
        },
        Launch::Refused { failure },
    )
}

/// `<cyvra.home>` could not be resolved, so there is nowhere to read an
/// activation from and nowhere to write one.
///
/// Fails closed at the door: the operator gets the silent activation screen
/// and nothing is attempted, because a workstation that cannot say *where* it
/// keeps its licence cannot be trusted to say whether it holds one. The audit
/// trail is unwritable for the same reason, so the caller is expected to log
/// `HomeUnavailable` itself.
fn no_home() -> LaunchOutcome {
    LaunchOutcome {
        launch: Launch::LocalFault,
        audit: Err(AuditError::HomeUnavailable),
        ledger: Err(LedgerError::HomeUnavailable),
    }
}

/// A local fault the activation layer itself did not originate.
///
/// `commands` reaches for this when it cannot even form a request (a machine
/// that withholds its hardware identity). It is `pub(crate)` rather than `pub`
/// so it stays a wiring detail: the screen never names a cause, it only stays
/// on the activation view.
pub(crate) fn local_fault(home: &Path, now_unix: u64, code: &'static str) -> LaunchOutcome {
    record(
        home,
        AuditLine {
            at_unix: now_unix,
            event: AuditEvent::LocalFault,
            code: Some(code.to_string()),
        },
        Launch::LocalFault,
    )
}

/// Writes the line, then reports whether it made it.
///
/// The ledger entry rides along here rather than being appended by each caller:
/// every one of these paths is a *decision*, and the mapping from a decision to
/// its place in the revision ledger belongs in one function where it can be
/// read next to the audit event it derives from.
fn record(home: &Path, line: AuditLine, launch: Launch) -> LaunchOutcome {
    let audit = append_audit(home, &line).map(|()| line.clone());
    let ledger = match ledger_request(&line) {
        Some(request) => ledger::append(home, request, &FixedClock::new(line.at_unix))
            .map(|entry| log_ledger(&entry)),
        None => Ok(()),
    };
    LaunchOutcome {
        launch,
        audit,
        ledger,
    }
}

/// Which of the six ledger events this decision is, if any.
///
/// A refusal, a screen-shown and a local fault are *not* ledger events: the
/// ledger records what was done to the licence (bound, revalidated, spent on
/// grace), and none of those three happened. Only the four state changes that
/// alter the workstation's standing with the server are appended.
fn ledger_request(line: &AuditLine) -> Option<LedgerRequest> {
    match line.event {
        AuditEvent::FirstActivation => Some(LedgerRequest::new(LedgerEvent::Activation)),
        AuditEvent::AuthorizedDeviceRevalidation => {
            Some(LedgerRequest::new(LedgerEvent::Revalidation))
        }
        // Offline by construction: both describe entry on cached state, which
        // is exactly the provenance the ledger view has to label.
        AuditEvent::OfflineGraceEntry => {
            Some(LedgerRequest::new(LedgerEvent::GraceEntered).offline(true))
        }
        AuditEvent::OfflineGraceExpired => {
            Some(LedgerRequest::new(LedgerEvent::GraceExpired).offline(true))
        }
        AuditEvent::ActivationRefused
        | AuditEvent::ActivationScreenShown
        | AuditEvent::LocalFault => None,
    }
}

/// The ledger's failures are logged, never raised.
///
/// It is a record of what happened, not a gate on whether it may happen: a
/// full disk must not keep a licensed operator out of their own application,
/// and this module already treats the audit trail the same way.
fn log_ledger(entry: &ledger::LedgerEntry) {
    log::debug!(
        "ledger entry {} appended: {}",
        entry.seq,
        entry.event.as_str()
    );
}

/// Stable machine codes for storage failures. Audit only, never displayed.
fn store_code(error: &StoreError) -> &'static str {
    match error {
        StoreError::HomeUnavailable => "STORE_HOME_UNAVAILABLE",
        StoreError::Unreadable => "STORE_UNREADABLE",
        StoreError::Corrupt => "STORE_CORRUPT",
        StoreError::ProtectFailed => "STORE_PROTECT_FAILED",
        StoreError::UnprotectFailed => "STORE_UNPROTECT_FAILED",
        StoreError::SerializeFailed => "STORE_SERIALIZE_FAILED",
    }
}

/// RFC 3339 / ISO-8601 UTC from Unix seconds, always with a `Z` suffix.
///
/// `chrono` is already in this crate (the Host support log names its files
/// with it), so there is no reason to hand-roll date arithmetic for `stored_at`
/// and re-test a leap-year table of our own.
pub fn iso8601(unix: u64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp(unix.min(i64::MAX as u64) as i64, 0)
        .map(|instant| instant.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activation::fake::{self, FakeLicenseApiClient, GRACE_24H, SERVER_NOW};

    const FINGERPRINT: &str =
        "9f2c0e5b1f8a4d6c3b2a190817161514131211100f0e0d0c0b0a090807060504";
    /// Signature marker of the *full* entitlement snapshot.
    const FULL: &str = "ZnVsbC1zaWduYXR1cmU";
    /// Signature marker of the *restricted offline* lease.
    const LEASE: &str = "bGVhc2Utc2lnbmF0dXJl";
    const SEED_TOKEN: &str = "device-token-seeded";

    fn temp_home() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("cyvra-state-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn request() -> ActivationRequest {
        ActivationRequest {
            email: "operator@example.com".to_string(),
            licence_key: "CYVRA-7Q2M-9K4X".to_string(),
            terms_version: "V1.0-DRAFT".to_string(),
            app_version: "1.0.0".to_string(),
            device_fingerprint: FINGERPRINT.to_string(),
        }
    }

    fn seed_record() -> StoredActivation {
        match fake::granted_with_token(BindingOutcome::FirstActivation, SEED_TOKEN) {
            ActivationOutcome::Success(success) => StoredActivation::from_success(
                success,
                "operator@example.com",
                FINGERPRINT,
                iso8601(SERVER_NOW),
            ),
            other => panic!("fixture must be a grant, got {other:?}"),
        }
    }

    fn seed(home: &Path) {
        let record = seed_record();
        // Leave the world as it would be after a successful online session:
        // token on file *and* the full entitlement already handed to the Host.
        entitlement::export(home, &record.entitlement, &record.server_time).expect("seed export");
        store::write(home, &record).expect("seed the store");
    }

    fn exported(home: &Path) -> String {
        std::fs::read_to_string(entitlement::entitlement_path(home)).expect("entitlement exported")
    }

    fn event_of(outcome: &LaunchOutcome) -> AuditEvent {
        outcome
            .audit
            .clone()
            .expect("the audit line must be produced")
            .event
    }

    // ------------------------------------------------------------------
    // Success
    // ------------------------------------------------------------------

    #[test]
    fn first_activation_binds_persists_exports_the_full_entitlement_and_audits_a_new_binding() {
        let home = temp_home();
        let api = FakeLicenseApiClient::default();

        let outcome = activate(&home, &api, &request(), SERVER_NOW);

        assert_eq!(outcome.launch, Launch::Enter { offline: false });
        assert_eq!(event_of(&outcome), AuditEvent::FirstActivation);

        let stored = store::read(&home)
            .expect("store readable")
            .expect("the token must be on file after a successful binding");
        assert_eq!(stored.device_token, "device-token-abcdef");

        let written = exported(&home);
        assert!(written.contains(FULL), "the full entitlement goes to the Host online");
        assert!(!written.contains(LEASE), "the restricted lease is not for an online session");
    }

    #[test]
    fn a_stored_token_revalidates_silently_and_enters_with_no_second_login() {
        let home = temp_home();
        seed(&home);
        let api = FakeLicenseApiClient::default();

        let outcome = launch(&home, &api, SERVER_NOW + 60);

        assert_eq!(outcome.launch, Launch::Enter { offline: false });
        assert_eq!(
            event_of(&outcome),
            AuditEvent::AuthorizedDeviceRevalidation
        );

        let transcript = api.transcript();
        assert_eq!(transcript.len(), 1, "exactly one server call, no form in between");
        assert!(
            transcript[0].starts_with("REVALIDATE "),
            "got: {}",
            transcript[0]
        );
        assert!(transcript[0].contains("AUTHORIZED_DEVICE_REVALIDATION"));
    }

    // ------------------------------------------------------------------
    // The revision ledger
    // ------------------------------------------------------------------

    fn ledger_events(home: &Path) -> Vec<crate::ledger::LedgerEvent> {
        ledger::read_entries(home)
            .expect("ledger readable")
            .into_iter()
            .map(|entry| entry.event)
            .collect()
    }

    #[test]
    fn a_first_binding_is_recorded_in_the_ledger_as_a_live_event() {
        let home = temp_home();

        let outcome = activate(&home, &FakeLicenseApiClient::default(), &request(), SERVER_NOW);

        assert!(outcome.ledger.is_ok(), "the ledger result must come back, not vanish");
        assert_eq!(ledger_events(&home), vec![crate::ledger::LedgerEvent::Activation]);

        let entries = ledger::read_entries(&home).unwrap();
        assert!(
            !entries[0].offline,
            "an online binding is a live event, never cached state"
        );
        ledger::verify_chain(&entries).expect("the chain must hold from genesis");
    }

    #[test]
    fn every_successful_revalidation_is_its_own_ledger_entry() {
        let home = temp_home();
        seed(&home);

        launch(&home, &FakeLicenseApiClient::default(), SERVER_NOW + 60);
        launch(&home, &FakeLicenseApiClient::default(), SERVER_NOW + 120);

        assert_eq!(
            ledger_events(&home),
            vec![
                crate::ledger::LedgerEvent::Revalidation,
                crate::ledger::LedgerEvent::Revalidation,
            ],
            "each launch that the server confirmed is a separate fact"
        );
    }

    #[test]
    fn riding_the_grace_window_is_recorded_as_offline_state() {
        let home = temp_home();
        seed(&home);
        let api = FakeLicenseApiClient::default().unreachable();

        let outcome = launch(&home, &api, SERVER_NOW + 60);

        assert_eq!(outcome.launch, Launch::Enter { offline: true });
        assert_eq!(
            ledger_events(&home),
            vec![crate::ledger::LedgerEvent::GraceEntered]
        );

        let entries = ledger::read_entries(&home).unwrap();
        assert!(
            entries[0].offline,
            "grace is cached state by definition, and the view labels it as such"
        );
    }

    #[test]
    fn grace_running_out_is_recorded_on_every_refused_launch() {
        let home = temp_home();
        seed(&home);
        let api = FakeLicenseApiClient::default().unreachable();

        let past = SERVER_NOW + GRACE_24H + 1;
        let first = launch(&home, &api, past);
        let second = launch(&home, &api, past + 60);

        for outcome in [&first, &second] {
            assert!(matches!(outcome.launch, Launch::Refused { .. }));
        }

        assert_eq!(
            ledger_events(&home),
            vec![
                crate::ledger::LedgerEvent::GraceExpired,
                crate::ledger::LedgerEvent::GraceExpired,
            ]
        );
        let entries = ledger::read_entries(&home).unwrap();
        assert!(entries.iter().all(|entry| entry.offline));
        ledger::verify_chain(&entries).expect("chain must hold");
    }

    #[test]
    fn a_refusal_reaches_the_audit_trail_but_never_the_ledger() {
        let home = temp_home();
        let api =
            FakeLicenseApiClient::default().activate_answers(vec![fake::refused(FailureKind::InvalidLicence)]);

        let outcome = activate(&home, &api, &request(), SERVER_NOW);

        // The audit line still lands: a refusal is a decision worth keeping.
        assert_eq!(event_of(&outcome), AuditEvent::ActivationRefused);
        // The ledger does not move: it records what was *done* to the licence,
        // and the server saying no is not something this machine did.
        assert!(
            ledger_events(&home).is_empty(),
            "the ledger records acts, not refusals"
        );
        assert!(outcome.ledger.is_ok());
    }

    #[test]
    fn the_ledger_verdict_travels_back_instead_of_being_swallowed() {
        let home = temp_home();

        let outcome = activate(&home, &FakeLicenseApiClient::default(), &request(), SERVER_NOW);

        // Same contract as the audit line: a full disk must never deny a
        // paying customer entry, and must never be silent about it either.
        assert_eq!(outcome.ledger, Ok(()));
    }

    // ------------------------------------------------------------------
    // The six verdicts
    // ------------------------------------------------------------------

    #[test]
    fn every_verdict_is_expressed_correctly_on_all_three_surfaces() {
        // Three places have to agree and yet not say the same thing:
        //   transcript -> the stable code, for support
        //   screen     -> the operator's own wording, nothing else
        //   audit      -> the stable code, never the wording
        let table = [
            (FailureKind::InvalidUser, "INVALID_USER", "invalid user"),
            (FailureKind::InvalidLicence, "INVALID_LICENCE", "invalid licence"),
            (
                FailureKind::LicenceNotActive,
                "LICENCE_NOT_ACTIVE",
                "licence not active",
            ),
            (FailureKind::LicenceExpired, "LICENCE_EXPIRED", "licence expired"),
            (
                FailureKind::AlreadyBoundToAnotherComputer,
                "ALREADY_BOUND",
                "already bound to another computer",
            ),
            (FailureKind::NetworkError, "NETWORK_ERROR", "network error"),
        ];

        for (failure, code, wording) in table {
            let home = temp_home();
            let api = FakeLicenseApiClient::default().activate_answers(vec![fake::refused(failure)]);
            let outcome = activate(&home, &api, &request(), SERVER_NOW);

            let transcript = api.transcript();
            assert_eq!(transcript.len(), 1);
            assert_eq!(
                transcript[0],
                format!(
                    "ACTIVATE email=operator@example.com terms=V1.0-DRAFT app=1.0.0 \
                     fingerprint={FINGERPRINT} -> REFUSED {code}"
                ),
                "the exchange must be quotable verbatim"
            );

            match outcome.launch {
                Launch::Refused { failure } => assert_eq!(failure.as_str(), wording),
                other => panic!("expected a refusal for {wording}, got {other:?}"),
            }

            let line = outcome.audit.expect("audit line");
            assert_eq!(line.code.as_deref(), Some(code), "the record keeps the code");
            assert_ne!(
                line.code.as_deref(),
                Some(wording),
                "an audit line must never store the display wording"
            );
        }
    }

    #[test]
    fn an_already_bound_licence_refuses_and_leaves_nothing_for_the_host_to_pick_up() {
        let home = temp_home();
        let api = FakeLicenseApiClient::default()
            .activate_answers(vec![fake::refused(
                FailureKind::AlreadyBoundToAnotherComputer,
            )]);

        let outcome = activate(&home, &api, &request(), SERVER_NOW);

        assert_eq!(
            outcome.launch,
            Launch::Refused {
                failure: FailureKind::AlreadyBoundToAnotherComputer
            }
        );
        assert!(
            store::read(&home).expect("store readable").is_none(),
            "a refusal must not persist an activation"
        );
        assert!(
            !entitlement::entitlement_path(&home).exists(),
            "a refusal must not hand the Host an entitlement"
        );

        let line = outcome.audit.expect("audit line");
        assert_eq!(line.event, AuditEvent::ActivationRefused);
        assert_eq!(line.code.as_deref(), Some("ALREADY_BOUND"));
    }

    #[test]
    fn a_refusal_never_clears_the_stored_activation() {
        // There is no local reset anywhere: the server stays the only authority
        // that can change what this computer is allowed to do.
        let home = temp_home();
        seed(&home);
        let before = seed_record();
        let api = FakeLicenseApiClient::default()
            .revalidate_answers(vec![fake::refused(FailureKind::LicenceExpired)]);

        let outcome = launch(&home, &api, SERVER_NOW);

        assert_eq!(
            outcome.launch,
            Launch::Refused {
                failure: FailureKind::LicenceExpired
            }
        );
        assert_eq!(
            store::read(&home).expect("store readable").expect("still there"),
            before,
            "the token must be left exactly as the server issued it"
        );
    }

    #[test]
    fn a_revalidation_that_comes_back_as_a_new_binding_is_refused_not_adopted() {
        let home = temp_home();
        seed(&home);
        let api = FakeLicenseApiClient::default().revalidate_answers(vec![
            fake::granted_with_token(BindingOutcome::FirstActivation, "device-token-rotated"),
        ]);

        let outcome = launch(&home, &api, SERVER_NOW);

        assert_eq!(
            outcome.launch,
            Launch::Refused {
                failure: FailureKind::InvalidLicence
            }
        );
        let stored = store::read(&home).expect("store readable").expect("still there");
        assert_eq!(
            stored.device_token, SEED_TOKEN,
            "a suspicious reply must not rewrite this computer's token"
        );
    }

    // ------------------------------------------------------------------
    // Offline grace
    // ------------------------------------------------------------------

    #[test]
    fn offline_within_grace_enters_and_swaps_in_the_restricted_lease() {
        let home = temp_home();
        seed(&home);
        let api = FakeLicenseApiClient::default().unreachable();

        let outcome = launch(&home, &api, SERVER_NOW + 60);

        assert_eq!(outcome.launch, Launch::Enter { offline: true });
        assert_eq!(event_of(&outcome), AuditEvent::OfflineGraceEntry);

        let written = exported(&home);
        assert!(written.contains(LEASE), "offline hands the Host the restricted lease");
        assert!(!written.contains(FULL), "the full entitlement must never go out offline");
    }

    #[test]
    fn grace_ends_on_the_servers_instant_not_one_second_later() {
        let deadline = SERVER_NOW + GRACE_24H;
        let home = temp_home();
        seed(&home);
        let api = FakeLicenseApiClient::default().unreachable();

        let last_second = launch(&home, &api, deadline);
        assert_eq!(last_second.launch, Launch::Enter { offline: true });

        let past = launch(&home, &api, deadline + 1);
        assert_eq!(
            past.launch,
            Launch::Refused {
                failure: FailureKind::NetworkError
            }
        );
        assert_eq!(event_of(&past), AuditEvent::OfflineGraceExpired);
    }

    #[test]
    fn offline_past_grace_is_a_refusal_and_hands_the_host_nothing_new() {
        let home = temp_home();
        seed(&home);
        let api = FakeLicenseApiClient::default().unreachable();

        let outcome = launch(&home, &api, SERVER_NOW + GRACE_24H + 1);

        assert_eq!(
            outcome.launch,
            Launch::Refused {
                failure: FailureKind::NetworkError
            }
        );
        assert_eq!(event_of(&outcome), AuditEvent::OfflineGraceExpired);
        // The file written while we were last online is left alone rather than
        // being downgraded to something the server did not sign just now.
        assert!(
            exported(&home).contains(FULL),
            "a refusal must not overwrite the snapshot the server last signed"
        );
    }

    #[test]
    fn offline_without_any_activation_reports_the_network_verdict() {
        let home = temp_home();
        let api = FakeLicenseApiClient::default().unreachable();

        let outcome = launch(&home, &api, SERVER_NOW);

        assert_eq!(
            outcome.launch,
            Launch::Refused {
                failure: FailureKind::NetworkError
            }
        );
    }

    #[test]
    fn online_without_any_activation_is_the_screen_with_nothing_to_report() {
        let home = temp_home();
        let api = FakeLicenseApiClient::default();

        let outcome = launch(&home, &api, SERVER_NOW);

        assert_eq!(outcome.launch, Launch::NeedsActivation);
        assert_eq!(event_of(&outcome), AuditEvent::ActivationScreenShown);
    }

    // ------------------------------------------------------------------
    // The `code` field invariant
    // ------------------------------------------------------------------

    /// `code` is present **iff** the line records a refusal or a local fault.
    ///
    /// The rule this pins, because the two failure modes are opposite and a
    /// later edit can reintroduce either:
    ///
    /// * a **successful** entry - grace or otherwise - carries no `code` at
    ///   all, and the key is absent from the JSONL, so an audit reader never
    ///   mistakes an ordinary launch for something having gone wrong;
    /// * a **refusal** or a **local fault** always carries one, so a reader can
    ///   never have to guess what the operator was told from the event name
    ///   alone.
    #[test]
    fn the_code_field_is_present_exactly_for_refusals_and_local_faults() {
        // --- neither a refusal nor a local fault: no `code` at all ---
        let mut clean = Vec::new();

        {
            // Fresh install: the screen with nothing to report.
            let home = temp_home();
            let outcome = launch(&home, &FakeLicenseApiClient::default(), SERVER_NOW);
            clean.push(("first launch", outcome));
        }

        {
            let home = temp_home();
            seed(&home);
            let outcome = launch(&home, &FakeLicenseApiClient::default(), SERVER_NOW);
            clean.push(("silent revalidation", outcome));
        }

        {
            let home = temp_home();
            seed(&home);
            let api = FakeLicenseApiClient::default().unreachable();
            let outcome = launch(&home, &api, SERVER_NOW + 60);
            clean.push(("offline grace entry", outcome));
        }

        for (label, outcome) in clean {
            assert!(
                !matches!(outcome.launch, Launch::Refused { .. } | Launch::LocalFault),
                "{label} must be neither a refusal nor a local fault, got {:?}",
                outcome.launch
            );
            let line = outcome.audit.expect("audit line");
            assert_eq!(line.code, None, "{label} must carry no code");

            let json = serde_json::to_string(&line).expect("serializable");
            assert!(
                !json.contains("\"code\""),
                "{label} must omit the code key entirely, got {json}"
            );
        }

        // --- refusals and local faults: always a code ---
        let mut faults = Vec::new();

        {
            let home = temp_home();
            seed(&home);
            let api = FakeLicenseApiClient::default().unreachable();
            faults.push((
                "grace expired",
                launch(&home, &api, SERVER_NOW + GRACE_24H + 1),
            ));
        }

        {
            let home = temp_home();
            let api = FakeLicenseApiClient::default()
                .activate_answers(vec![fake::refused(FailureKind::LicenceExpired)]);
            faults.push(("server refusal", activate(&home, &api, &request(), SERVER_NOW)));
        }

        {
            let home = temp_home();
            seed(&home);
            let path = store::store_path(&home);
            let mut bytes = std::fs::read(&path).expect("raw store");
            let last = bytes.len() - 1;
            bytes[last] ^= 0xFF;
            std::fs::write(&path, bytes).expect("damage the store");
            faults.push((
                "local fault",
                launch(&home, &FakeLicenseApiClient::default(), SERVER_NOW),
            ));
        }

        for (label, outcome) in faults {
            let line = outcome.audit.expect("audit line");
            let code = line
                .code
                .as_deref()
                .unwrap_or_else(|| panic!("{label} must carry a code"));

            let json = serde_json::to_string(&line).expect("serializable");
            assert!(json.contains("\"code\""), "{label} must keep its code: {json}");
            assert_ne!(
                line.event,
                AuditEvent::OfflineGraceEntry,
                "grace entry is a success and never a coded line"
            );
            assert!(code.chars().all(|c| c.is_ascii_uppercase() || c == '_'));
        }
    }

    #[test]
    fn without_an_installation_root_there_is_no_decision_and_no_attempt() {
        let api = FakeLicenseApiClient::default();

        let outcome = launch(Path::new(""), &api, SERVER_NOW);

        assert_eq!(outcome.launch, Launch::LocalFault);
        assert_eq!(outcome.audit, Err(AuditError::HomeUnavailable));
        assert!(
            api.transcript().is_empty(),
            "nothing may be asked of the server when there is nowhere to look"
        );
    }

    #[test]
    fn an_activation_cannot_be_committed_without_an_installation_root() {
        let api = FakeLicenseApiClient::default();

        let outcome = activate(Path::new(""), &api, &request(), SERVER_NOW);

        assert_eq!(outcome.launch, Launch::LocalFault);
        assert_eq!(outcome.audit, Err(AuditError::HomeUnavailable));
        assert!(
            api.transcript().is_empty(),
            "a workstation with no home must not reach the network"
        );
    }

    // ------------------------------------------------------------------
    // Local defects
    // ------------------------------------------------------------------

    #[test]
    fn a_corrupt_store_is_a_local_fault_never_a_first_launch() {
        let home = temp_home();
        seed(&home);

        let path = store::store_path(&home);
        let mut bytes = std::fs::read(&path).expect("raw store");
        let last = bytes.len() - 1;
        bytes[last] ^= 0xFF;
        std::fs::write(&path, bytes).expect("damage the store");

        let outcome = launch(&home, &FakeLicenseApiClient::default(), SERVER_NOW);

        assert_eq!(outcome.launch, Launch::LocalFault);
        let line = outcome.audit.expect("audit line");
        assert_eq!(line.event, AuditEvent::LocalFault);
        let code = line.code.as_deref().expect("the cause must be recorded");
        assert!(
            code.starts_with("STORE_"),
            "the cause is a storage code for support, got: {code}"
        );
        assert_ne!(
            outcome.launch,
            Launch::NeedsActivation,
            "a damaged store must never be reported as a workstation that was never activated"
        );
    }

    #[test]
    fn a_local_fault_never_borrows_one_of_the_operators_verdicts() {
        let home = temp_home();
        seed(&home);
        std::fs::write(store::store_path(&home), b"").expect("empty the store");

        let outcome = launch(&home, &FakeLicenseApiClient::default(), SERVER_NOW);
        assert_eq!(outcome.launch, Launch::LocalFault);

        // `Launch::LocalFault` carries no payload, so there is nowhere for an
        // internal detail to be read from even if a future screen tried; the
        // only text this decision produces is the audit code below.
        let code = outcome
            .audit
            .expect("audit line")
            .code
            .expect("a cause is recorded");
        let six = [
            "invalid user",
            "invalid licence",
            "licence not active",
            "licence expired",
            "already bound to another computer",
            "network error",
        ];
        assert!(
            !six.contains(&code.as_str()),
            "a local defect must not masquerade as a licence verdict, got: {code}"
        );
    }

    #[test]
    fn a_missing_grace_deadline_is_a_refusal_not_an_open_window() {
        // `0` decodes to 1970, not to "no limit": a server answer that forgot
        // to name an instant must refuse rather than grant forever.
        let home = temp_home();
        let mut record = seed_record();
        record.grace_expires_at_unix = 0;
        entitlement::export(&home, &record.entitlement, &record.server_time).expect("seed export");
        store::write(&home, &record).expect("seed the store");
        let api = FakeLicenseApiClient::default().unreachable();

        let outcome = launch(&home, &api, SERVER_NOW);

        assert_eq!(
            outcome.launch,
            Launch::Refused {
                failure: FailureKind::NetworkError
            }
        );
        assert_eq!(event_of(&outcome), AuditEvent::OfflineGraceExpired);
    }

    // ------------------------------------------------------------------
    // Audit trail
    // ------------------------------------------------------------------

    #[test]
    fn the_audit_trail_appends_one_json_object_per_line() {
        let home = temp_home();
        let api = FakeLicenseApiClient::default();

        launch(&home, &api, SERVER_NOW);
        launch(&home, &api, SERVER_NOW + 1);

        let text = std::fs::read_to_string(audit_path(&home)).expect("audit file");
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2, "each decision gets its own line");
        assert!(text.ends_with('\n'), "the file stays appendable");
        for line in lines {
            let parsed: AuditLine = serde_json::from_str(line).expect("one object per line");
            assert_eq!(parsed.event, AuditEvent::ActivationScreenShown);
        }
    }

    #[test]
    fn the_two_binding_events_are_never_confused() {
        let home = temp_home();

        activate(
            &home,
            &FakeLicenseApiClient::default(),
            &request(),
            SERVER_NOW,
        );
        let first = std::fs::read_to_string(audit_path(&home)).expect("audit");

        launch(&home, &FakeLicenseApiClient::default(), SERVER_NOW + 5);
        let both = std::fs::read_to_string(audit_path(&home)).expect("audit");

        assert!(first.contains("FIRST_ACTIVATION"), "got: {first}");
        assert!(both.contains("AUTHORIZED_DEVICE_REVALIDATION"), "got: {both}");
        assert_ne!(
            first.trim_end().lines().last(),
            both.trim_end().lines().last(),
            "the two decisions must be distinguishable on disk"
        );
    }

    // ------------------------------------------------------------------
    // Time
    // ------------------------------------------------------------------

    #[test]
    fn timestamps_are_iso8601_utc() {
        assert_eq!(iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601(SERVER_NOW), "2026-09-30T10:00:00Z");
        assert_eq!(
            iso8601(SERVER_NOW + GRACE_24H),
            "2026-10-01T10:00:00Z",
            "the grace deadline and its rendering must agree"
        );
        // A leap day and a year boundary, both outside the 2026 test range.
        assert_eq!(iso8601(1_709_164_800), "2024-02-29T00:00:00Z");
        assert_eq!(iso8601(1_798_761_599), "2026-12-31T23:59:59Z");
    }
}

