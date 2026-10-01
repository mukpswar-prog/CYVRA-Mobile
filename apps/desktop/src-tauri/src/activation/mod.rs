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

/// The production transport: a seam with no wire behind it yet.
///
/// Real `cyvoriq.co.in` endpoint wiring is deliberately out of scope for this
/// package. Until it lands, a shipped build has a client that answers
/// `network error` to everything it is asked, so nothing can be activated by
/// accident and nothing can be activated at all.
pub mod client;

/// Tauri commands the activation screen drives.
pub mod commands;

/// Test-only server. Not compiled into a shippable bundle.
#[cfg(test)]
pub mod fake;

pub use fingerprint::{device_fingerprint, FingerprintError};
