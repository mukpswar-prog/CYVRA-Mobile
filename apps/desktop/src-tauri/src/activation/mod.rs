//! Commercial activation wrapper around the frozen inspection core.
//!
//! The launch sequence this module implements is a *wrapper*: it decides
//! whether the operator ever reaches the existing application, and it never
//! participates in scanning, reporting or sanitization.
//!
//! ```text
//! FIRST LAUNCH -> TERMS -> REGISTERED EMAIL -> LICENCE KEY
//!     -> SERVER VALIDATION -> FIRST DEVICE BINDING -> SUCCESS -> EXISTING APP
//! ```
//!
//! Two invariants are structural rather than conventional:
//!
//! * The device token and the entitlement snapshot are written through Windows
//!   DPAPI. They never exist on disk in plaintext and there is no code path
//!   anywhere that deletes or resets an activation.
//! * Every refusal is expressed as one of six operator-facing strings. Internal
//!   API errors, transport detail and storage detail are logged locally and
//!   never reach the UI.

pub mod api;
pub mod entitlement;
pub mod fingerprint;
pub mod state;
pub mod store;

/// The transport with no wire behind it: `network error` to everything.
///
/// Endpoint wiring now lives in [`live_client`], so this is no longer what a
/// healthy shipped build runs - it is the fail-closed fallback for a build
/// whose `CYVRA_ACTIVATION_BASE_URL` is set but unusable. Nothing in here can
/// ever say "yes", which is still the point: a build that cannot reach the
/// licensing service must never be mistaken for an approving one.
pub mod client;

/// The transport that reaches the licensing service. **This is the shipped path.**
///
/// [`live_client::production_client`] dials [`live_client::DEFAULT_BASE_URL`]
/// when `CYVRA_ACTIVATION_BASE_URL` is unset, so an installed exe can activate
/// with no configuration. It falls back to the placeholder above only when that
/// variable is set to something unusable.
pub mod live_client;

/// Tauri commands the activation screen drives.
pub mod commands;

/// Test-only server. Not compiled into a shippable bundle.
#[cfg(test)]
pub mod fake;

pub use fingerprint::{device_fingerprint, FingerprintError};
