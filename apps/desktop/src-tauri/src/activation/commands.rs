//! Tauri surface for the activation layer.
//!
//! Two commands, both of which decide nothing. The verdict comes from
//! [`crate::activation::state`]; these only move bytes between that state
//! machine and the screen. That separation is what keeps the six operator
//! strings in exactly one place and stops the frontend from ever inventing a
//! seventh.
//!
//! Neither command accepts a terms version from the caller. What is recorded
//! against a licence is the version *this binary* bundles, so a modified
//! frontend cannot tick a box and claim whichever document it likes.

use crate::activation::live_client;
use crate::activation::state::{self, LaunchOutcome};
use crate::host_process;
use serde::Serialize;
use std::path::PathBuf;

/// Version of the Software Licence Terms this build ships inside
/// `assets/docs/TERMS_V1.0-DRAFT.md`.
///
/// Echoed to the screen for display and used verbatim as the acceptance sent
/// to the server, so the two can never drift.
pub const TERMS_VERSION: &str = "V1.0-DRAFT";

/// Everything the activation screen is allowed to know.
///
/// Deliberately small: a view to render, whether entry is riding the grace
/// window, and at most one of the six verdicts. Internal causes - a missing
/// installation root, an unreadable store, a withheld hardware identity - reach
/// the audit trail and this module's log line, and never the `message` field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationDecision {
    /// `enter` | `needsActivation` | `refused` | `localFault`.
    pub state: &'static str,
    /// True only when entry is riding the offline grace window, so the
    /// application can label cached data as cached.
    pub offline: bool,
    /// One of the six verdicts, or `null` when there is nothing to report.
    pub message: Option<String>,
    /// Terms version bundled with this build, for the screen to display.
    pub terms_version: &'static str,
}

impl ActivationDecision {
    /// Keep the operator on the activation view and say nothing.
    ///
    /// Used when a decision could not be reached at all. It is *not* an
    /// invitation to try again harder: no decision means no entry, and no
    /// invented sentence means no fiction about why.
    fn declined() -> Self {
        ActivationDecision {
            state: "localFault",
            offline: false,
            message: None,
            terms_version: TERMS_VERSION,
        }
    }
}

/// Turns a launch outcome into the only shape the frontend may see.
fn render(outcome: LaunchOutcome) -> ActivationDecision {
    if let Err(error) = &outcome.audit {
        // Not fatal - a full disk must never deny entry - but never silent.
        log::warn!("activation audit line not written: {error}");
    }

    let (name, offline, message) = match outcome.launch {
        state::Launch::Enter { offline } => ("enter", offline, None),
        state::Launch::NeedsActivation => ("needsActivation", false, None),
        state::Launch::LocalFault => ("localFault", false, None),
        state::Launch::Refused { failure } => {
            ("refused", false, Some(failure.as_str().to_string()))
        }
    };

    ActivationDecision {
        state: name,
        offline,
        message,
        terms_version: TERMS_VERSION,
    }
}

/// Resolves `<cyvra.home>` for one command.
///
/// On failure an empty path is handed down, which the state machine treats as
/// a local fault with an unwritable audit trail: the screen stays up, says
/// nothing, and this log line is the only record of why.
fn home() -> PathBuf {
    match host_process::cyvra_home() {
        Ok(root) => root,
        Err(error) => {
            log::warn!("activation cannot resolve an installation root: {error}");
            PathBuf::new()
        }
    }
}

/// Runs a decision off the async runtime.
///
/// Launch and submit both touch the filesystem and DPAPI, and neither belongs
/// on a runtime thread. If the blocking task cannot be scheduled the operator
/// stays on the activation view with nothing to report.
async fn decide(compute: impl FnOnce() -> LaunchOutcome + Send + 'static) -> ActivationDecision {
    match tauri::async_runtime::spawn_blocking(compute).await {
        Ok(outcome) => render(outcome),
        Err(error) => {
            log::warn!("activation decision could not be computed: {error}");
            ActivationDecision::declined()
        }
    }
}

/// First-paint decision: may this operator reach the existing application?
///
/// Called once when the window opens. It is a *read* of the stored activation
/// plus, when there is one, a read-only revalidation - it never writes a
/// binding, never deletes one, and never asks the operator for anything.
#[tauri::command]
pub async fn activation_launch() -> ActivationDecision {
    decide(|| {
        state::launch(
            &home(),
            live_client::production_client(),
            state::system_now_unix(),
        )
    })
    .await
}

/// The operator submitted the activation form.
///
/// The app version and the terms version come from this binary, the device
/// fingerprint is computed here rather than accepted from the screen, and the
/// verdict comes back from the state machine as one of the six strings or as
/// nothing at all.
#[tauri::command]
pub async fn activation_submit(
    app_handle: tauri::AppHandle,
    email: String,
    licence_key: String,
) -> ActivationDecision {
    let app_version = app_handle.package_info().version.to_string();
    let email = email.trim().to_string();
    let licence_key = licence_key.trim().to_string();

    decide(move || {
        let now = state::system_now_unix();
        let home = home();

        let request = match state::activation_request(
            email.as_str(),
            licence_key.as_str(),
            TERMS_VERSION,
            app_version.as_str(),
        ) {
                Ok(request) => request,
                Err(error) => {
                    // This workstation will not say which computer it is, so it
                    // was never asked and the server never answered. A local
                    // fault - not a licence verdict, because no verdict exists.
                    log::warn!("activation request could not be formed: {error}");
                    return state::local_fault(&home, now, "FINGERPRINT_UNAVAILABLE");
                }
            };

        state::activate(&home, live_client::production_client(), &request, now)
    })
    .await
}
