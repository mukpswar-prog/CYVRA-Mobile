//! An in-process licence server for tests.
//!
//! Every state-machine test runs against this rather than against a socket, so
//! all six verdicts, silence, and success are each one constructor call away.
//! It records a running transcript of what it was asked, which is what the exit
//! report quotes when it needs to show a real exchange rather than describe
//! one.
//!
//! The default is a healthy server: activation binds for the first time and
//! revalidation confirms the device. Tests opt into trouble explicitly, so a
//! forgotten setup fails optimistically rather than mysteriously.

use crate::activation::api::{
    ActivationOutcome, ActivationRequest, ActivationSuccess, BindingOutcome, FailureKind,
    LicenseApiClient, Reachability, SignedSnapshot,
};
use crate::activation::state::iso8601;
use std::collections::VecDeque;
use std::sync::Mutex;

/// The fake server's clock: 2026-09-30T10:00:00Z.
pub const SERVER_NOW: u64 = 1_790_762_400;

/// A 24-hour offline window, so `SERVER_NOW + GRACE_24H` = 2026-10-01T10:00:00Z.
pub const GRACE_24H: u64 = 86_400;

/// A granted activation with a grace window ending `grace_seconds` after
/// `server_unix`.
pub fn granted_at(binding: BindingOutcome, server_unix: u64, grace_seconds: u64) -> ActivationOutcome {
    ActivationOutcome::Success(ActivationSuccess {
        device_token: "device-token-abcdef".to_string(),
        entitlement: SignedSnapshot {
            payload: r#"{"licenseId":"LIC-MOB-2026-00124","plan":"25 Device Scans","scansRemaining":17,"offline":{"diagnostics":true,"sanitizeExecute":true,"upgrade":true}}"#.to_string(),
            signature: "ZnVsbC1zaWduYXR1cmU".to_string(),
        },
        offline_lease: SignedSnapshot {
            payload: r#"{"licenseId":"LIC-MOB-2026-00124","plan":"25 Device Scans","lease":true,"offline":{"diagnostics":true,"sanitizeExecute":false,"upgrade":false}}"#.to_string(),
            signature: "bGVhc2Utc2lnbmF0dXJl".to_string(),
        },
        server_time: iso8601(server_unix),
        grace_expires_at_unix: server_unix + grace_seconds,
        binding,
    })
}

/// A granted activation using the fake server's own clock.
pub fn granted(binding: BindingOutcome) -> ActivationOutcome {
    granted_at(binding, SERVER_NOW, GRACE_24H)
}

/// One of the six verdicts, verbatim.
pub fn refused(failure: FailureKind) -> ActivationOutcome {
    ActivationOutcome::Refused(failure)
}

/// A grant carrying a specific token, so a test can tell "this token was kept"
/// from "this token happened to look the same".
pub fn granted_with_token(binding: BindingOutcome, token: &str) -> ActivationOutcome {
    match granted(binding) {
        ActivationOutcome::Success(mut success) => {
            success.device_token = token.to_string();
            ActivationOutcome::Success(success)
        }
        other => other,
    }
}

#[derive(Default)]
pub struct FakeLicenseApiClient {
    reachable: Reachability,
    activate: Mutex<VecDeque<ActivationOutcome>>,
    revalidate: Mutex<VecDeque<ActivationOutcome>>,
    transcript: Mutex<Vec<String>>,
}

impl FakeLicenseApiClient {
    pub fn unreachable(mut self) -> Self {
        self.reachable = Reachability::Unreachable;
        self
    }

    /// Answers for successive `activate` calls. The final one repeats, so a
    /// test never falls off the end of its own script into a default.
    pub fn activate_answers(mut self, answers: Vec<ActivationOutcome>) -> Self {
        self.activate = Mutex::new(repeating(answers));
        self
    }

    /// Answers for successive `revalidate` calls. The final one repeats.
    pub fn revalidate_answers(mut self, answers: Vec<ActivationOutcome>) -> Self {
        self.revalidate = Mutex::new(repeating(answers));
        self
    }

    /// Every line the server was asked, in order.
    pub fn transcript(&self) -> Vec<String> {
        self.transcript
            .lock()
            .map(|lines| lines.clone())
            .unwrap_or_default()
    }

    fn next(queue: &Mutex<VecDeque<ActivationOutcome>>, fallback: ActivationOutcome) -> ActivationOutcome {
        queue
            .lock()
            .ok()
            .and_then(|mut queue| queue.pop_front())
            .unwrap_or(fallback)
    }

    fn record(&self, line: String) {
        if let Ok(mut transcript) = self.transcript.lock() {
            transcript.push(line);
        }
    }
}

impl LicenseApiClient for FakeLicenseApiClient {
    fn activate(&self, request: &ActivationRequest) -> ActivationOutcome {
        let answer = Self::next(&self.activate, self.fallback(BindingOutcome::FirstActivation));
        self.record(format!(
            "ACTIVATE email={} terms={} app={} fingerprint={} -> {}",
            request.email,
            request.terms_version,
            request.app_version,
            request.device_fingerprint,
            describe(&answer)
        ));
        answer
    }

    fn revalidate(&self, device_token: &str, device_fingerprint: &str) -> ActivationOutcome {
        let answer = Self::next(
            &self.revalidate,
            self.fallback(BindingOutcome::AuthorizedDeviceRevalidation),
        );
        self.record(format!(
            "REVALIDATE token={} fingerprint={} -> {}",
            device_token,
            device_fingerprint,
            describe(&answer)
        ));
        answer
    }

    fn reachability(&self) -> Reachability {
        self.record(format!("REACHABILITY -> {:?}", self.reachable));
        self.reachable
    }
}

impl FakeLicenseApiClient {
    /// What the server says when a test has not scripted the call: a healthy
    /// link grants, a dead one reports `network error` rather than granting
    /// over a link that is not there.
    ///
    /// Scripted answers always win, so a test can still model "the link came
    /// up but the licence was refused".
    fn fallback(&self, binding: BindingOutcome) -> ActivationOutcome {
        if self.reachable == Reachability::Unreachable {
            refused(FailureKind::NetworkError)
        } else {
            granted(binding)
        }
    }
}

/// Queues repeat their last answer instead of running dry.
fn repeating(answers: Vec<ActivationOutcome>) -> VecDeque<ActivationOutcome> {
    if answers.is_empty() {
        return VecDeque::new();
    }
    let last = answers.last().expect("checked non-empty").clone();
    answers.into_iter().chain(std::iter::once(last)).collect()
}

fn describe(outcome: &ActivationOutcome) -> String {
    match outcome {
        ActivationOutcome::Success(success) => match success.binding {
            BindingOutcome::FirstActivation => "OK FIRST_ACTIVATION".to_string(),
            BindingOutcome::AuthorizedDeviceRevalidation => {
                "OK AUTHORIZED_DEVICE_REVALIDATION".to_string()
            }
        },
        ActivationOutcome::Refused(failure) => format!("REFUSED {}", failure.code()),
    }
}
