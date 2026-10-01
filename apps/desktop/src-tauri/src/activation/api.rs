//! The activation client seam.
//!
//! `LicenseApiClient` is a trait, not a concrete transport, so every state
//! machine test runs against an in-process fake server that can answer with any
//! of the six verdicts on demand. The real endpoint is injected when the cloud
//! control plane is wired in; nothing in this crate hardcodes a URL.
//!
//! The request deliberately carries only what an activation needs and nothing
//! that identifies a phone: the workstation's own fingerprint proves which
//! computer this is, and phone identifiers have no business in a licence call.

use serde::{Deserialize, Serialize};

/// Everything the server is asked to validate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivationRequest {
    /// Registered User ID. The email the licence was issued to.
    pub email: String,
    /// Licence key as the operator typed it.
    pub licence_key: String,
    /// Version of the Software Licence Terms the operator ticked acceptance for.
    pub terms_version: String,
    /// Version of this application build.
    pub app_version: String,
    /// Digest of the workstation's hardware identity. Never a raw identifier.
    pub device_fingerprint: String,
}

/// The six things that can be wrong, and nothing else.
///
/// This is the whole vocabulary the operator ever sees. Transport errors,
/// HTTP status codes, JSON decode failures and storage errors are collapsed
/// into [`FailureKind::NetworkError`] rather than being passed through, so an
/// internal detail can never reach the screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FailureKind {
    InvalidUser,
    InvalidLicence,
    LicenceNotActive,
    LicenceExpired,
    AlreadyBoundToAnotherComputer,
    NetworkError,
}

impl FailureKind {
    /// All six, in declaration order.
    ///
    /// One place to iterate them, so a test that wants to prove "every verdict
    /// is one of these six" does not have to restate the list and risk drifting
    /// from it.
    pub const ALL: [FailureKind; 6] = [
        FailureKind::InvalidUser,
        FailureKind::InvalidLicence,
        FailureKind::LicenceNotActive,
        FailureKind::LicenceExpired,
        FailureKind::AlreadyBoundToAnotherComputer,
        FailureKind::NetworkError,
    ];

    /// The exact operator-facing wording. The single place these strings exist.
    pub fn as_str(self) -> &'static str {
        match self {
            FailureKind::InvalidUser => "invalid user",
            FailureKind::InvalidLicence => "invalid licence",
            FailureKind::LicenceNotActive => "licence not active",
            FailureKind::LicenceExpired => "licence expired",
            FailureKind::AlreadyBoundToAnotherComputer => "already bound to another computer",
            FailureKind::NetworkError => "network error",
        }
    }

    /// Stable code used for audit lines and tests. Never shown to an operator.
    pub fn code(self) -> &'static str {
        match self {
            FailureKind::InvalidUser => "INVALID_USER",
            FailureKind::InvalidLicence => "INVALID_LICENCE",
            FailureKind::LicenceNotActive => "LICENCE_NOT_ACTIVE",
            FailureKind::LicenceExpired => "LICENCE_EXPIRED",
            FailureKind::AlreadyBoundToAnotherComputer => "ALREADY_BOUND",
            FailureKind::NetworkError => "NETWORK_ERROR",
        }
    }
}

/// A server-signed snapshot: the exact text that was signed, and its signature.
///
/// Both halves are carried through untouched. The Rust layer never signs, never
/// re-serializes and never validates the signature - the Kotlin Host verifies it
/// against the bundled server public key and fails closed on any defect.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedSnapshot {
    pub payload: String,
    pub signature: String,
}

/// Whether this answer bound the computer for the first time or recognised it.
///
/// Two distinct code paths with two distinct audit events: a revalidation must
/// never be able to masquerade as a first binding, and a first binding must
/// never be recorded as if the computer were already known.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BindingOutcome {
    FirstActivation,
    AuthorizedDeviceRevalidation,
}

/// A successful validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivationSuccess {
    /// Opaque device token issued by the server. DPAPI-protected at rest.
    pub device_token: String,
    /// Full entitlement snapshot, exported for the Kotlin Host.
    pub entitlement: SignedSnapshot,
    /// Restricted offline lease the server signed alongside the entitlement.
    pub offline_lease: SignedSnapshot,
    /// Server's ISO-8601 clock at the moment of this answer. Kept for audit
    /// and for support ("the server said it was this time when we agreed").
    pub server_time: String,
    /// Absolute instant (Unix seconds) at which the offline grace window ends.
    ///
    /// The server decides this, not the workstation: a local clock never
    /// extends it, only a fresh server answer can. The signed offline lease
    /// carries the same instant for the Kotlin Host, so both halves of the
    /// wrapper run the same clock - and if they ever disagree, the Host's
    /// copy is the one that governs what is actually allowed to run.
    ///
    /// `0` is deliberately meaningless rather than "no limit": it decodes to
    /// 1970, which is already past, so a missing deadline refuses instead of
    /// granting forever.
    pub grace_expires_at_unix: u64,
    pub binding: BindingOutcome,
}

/// What a call to [`LicenseApiClient`] came back with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActivationOutcome {
    Success(ActivationSuccess),
    Refused(FailureKind),
}

/// Whether the licensing service could be reached at all for this launch.
///
/// Distinct from [`ActivationOutcome`] on purpose: an answer from the server is
/// information, a silence is not. Conflating them would let "the cable is out"
/// look like a licence verdict, or worse, let a licence verdict look like an
/// excuse to fall back on a cached one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum Reachability {
    /// A healthy link is the default, so a fake server that forgets to be
    /// scripted behaves like the real one under normal conditions.
    #[default]
    Reachable,
    Unreachable,
}

/// The seam every activation call goes through.
///
/// Implementations must be total: a transport that cannot be reached answers
/// [`ActivationOutcome::Refused`] with [`FailureKind::NetworkError`] rather than
/// returning an error type the caller could leak to the UI.
pub trait LicenseApiClient: Send + Sync {
    /// First activation: validate email + key and bind this computer.
    fn activate(&self, request: &ActivationRequest) -> ActivationOutcome;

    /// Silent revalidation of a stored token on launch. Read-only.
    fn revalidate(&self, device_token: &str, device_fingerprint: &str) -> ActivationOutcome;

    /// Is the licensing service reachable right now?
    ///
    /// This answers exactly one question: what an operator who has *never*
    /// activated is looking at while offline - the activation screen, or the
    /// network-error notice. It must never soften or override a verdict the
    /// server actually returned, and it must never be consulted to decide
    /// whether a stored token is still good: that is what
    /// [`LicenseApiClient::revalidate`] is for.
    fn reachability(&self) -> Reachability;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_operator_facing_vocabulary_is_exactly_six_strings() {
        let all = [
            FailureKind::InvalidUser,
            FailureKind::InvalidLicence,
            FailureKind::LicenceNotActive,
            FailureKind::LicenceExpired,
            FailureKind::AlreadyBoundToAnotherComputer,
            FailureKind::NetworkError,
        ];
        let words: Vec<&str> = all.iter().map(|f| f.as_str()).collect();

        assert_eq!(
            words,
            vec![
                "invalid user",
                "invalid licence",
                "licence not active",
                "licence expired",
                "already bound to another computer",
                "network error",
            ]
        );
        assert_eq!(words.iter().collect::<std::collections::HashSet<_>>().len(), 6);
    }

    #[test]
    fn every_refusal_carries_a_stable_audit_code_that_is_not_the_display_word() {
        let all = [
            FailureKind::InvalidUser,
            FailureKind::InvalidLicence,
            FailureKind::LicenceNotActive,
            FailureKind::LicenceExpired,
            FailureKind::AlreadyBoundToAnotherComputer,
            FailureKind::NetworkError,
        ];
        for failure in all {
            assert!(!failure.code().is_empty());
            assert_ne!(failure.code(), failure.as_str());
            assert!(failure
                .code()
                .chars()
                .all(|c| c.is_ascii_uppercase() || c == '_'));
        }
    }
}
