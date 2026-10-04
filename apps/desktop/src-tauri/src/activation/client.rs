//! The transport with no wire: a seam that fails closed on every call.
//!
//! Endpoint wiring lives in [`crate::activation::live_client`], which is what a
//! healthy shipped build runs. What ships here is a client that is *complete as
//! a type* and *deliberately incomplete as a feature*: it has no URL, no TLS
//! and no dependency it could reach out with, and it fails closed instead.
//!
//! The distinction that matters: this is not "offline". A workstation that is
//! genuinely offline may still enter on its grace window. This client is the
//! absence of a licensing service, so it answers [`Reachability::Unreachable`]
//! and [`FailureKind::NetworkError`] to everything - the one verdict the spec
//! assigns to "the licence service could not be spoken to". Nothing in here can
//! ever say "yes", which is the whole point: an unwired endpoint must never be
//! mistaken for an approving one.
//!
//! Tests do not use this type. They drive [`crate::activation::fake`], which can
//! answer with any of the six verdicts and record what it was asked.

use crate::activation::api::{
    ActivationOutcome, ActivationRequest, FailureKind, LicenseApiClient, Reachability,
};

/// Placeholder transport for a licensing endpoint that does not exist yet.
///
/// Total and infallible: no `Result`, no error variant, nothing for a caller to
/// accidentally render. [`FailureKind::NetworkError`] is the only answer, and
/// it is already one of the six strings the operator is allowed to see.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PlaceholderLicenseApiClient;

impl LicenseApiClient for PlaceholderLicenseApiClient {
    fn activate(&self, _request: &ActivationRequest) -> ActivationOutcome {
        ActivationOutcome::Refused(FailureKind::NetworkError)
    }

    fn revalidate(&self, _device_token: &str, _device_fingerprint: &str) -> ActivationOutcome {
        ActivationOutcome::Refused(FailureKind::NetworkError)
    }

    fn reachability(&self) -> Reachability {
        Reachability::Unreachable
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activation::api::ActivationSuccess;

    fn request() -> ActivationRequest {
        ActivationRequest {
            email: "operator@example.com".to_string(),
            licence_key: "CYVRA-0000-0000-0000-0000".to_string(),
            terms_version: "V1.0-DRAFT".to_string(),
            app_version: "0.1.0".to_string(),
            device_fingerprint: "9f2c0e5b".to_string(),
        }
    }

    #[test]
    fn a_real_build_cannot_activate_anything_before_the_endpoint_is_wired() {
        let client = PlaceholderLicenseApiClient;
        assert_eq!(
            client.activate(&request()),
            ActivationOutcome::Refused(FailureKind::NetworkError)
        );
    }

    #[test]
    fn a_stored_token_cannot_be_revalidated_before_the_endpoint_is_wired() {
        let client = PlaceholderLicenseApiClient;
        assert_eq!(
            client.revalidate("stored-device-token", "9f2c0e5b"),
            ActivationOutcome::Refused(FailureKind::NetworkError)
        );
    }

    #[test]
    fn the_placeholder_never_claims_the_service_is_reachable() {
        assert_eq!(
            PlaceholderLicenseApiClient.reachability(),
            Reachability::Unreachable
        );
    }

    #[test]
    fn every_answer_is_already_one_of_the_six_operator_facing_strings() {
        let client = PlaceholderLicenseApiClient;
        let verdicts = [
            client.activate(&request()),
            client.revalidate("token", "fingerprint"),
        ];

        for verdict in verdicts {
            let ActivationOutcome::Refused(failure) = verdict else {
                panic!("the placeholder must never approve an activation");
            };
            assert_eq!(failure.as_str(), "network error");
        }
    }

    #[test]
    fn the_placeholder_could_not_leak_a_success_it_did_not_have() {
        // The success type is what a real transport would return. Asserting the
        // placeholder's answers are not one of them keeps the seam honest: if a
        // later refactor widens this client, the test says so before a build
        // that cannot license anybody starts saying "granted".
        let client = PlaceholderLicenseApiClient;
        assert!(matches!(
            client.activate(&request()),
            ActivationOutcome::Refused(_)
        ));
        assert!(!matches!(
            client.activate(&request()),
            ActivationOutcome::Success(ActivationSuccess { .. })
        ));
    }

    #[test]
    fn the_placeholder_carries_no_endpoint_of_its_own() {
        // Guards the deferral: this type must not quietly grow a URL, a host or
        // a transport before the wiring task lands and decides what it is.
        let client = PlaceholderLicenseApiClient;
        let debug = format!("{client:?}");
        for token in ["http", "https", "cyvoriq", "Url", "host"] {
            assert!(
                !debug.contains(token),
                "placeholder client grew a transport detail: {debug}"
            );
        }
    }
}
