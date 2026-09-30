//! Export of the signed entitlement snapshot for the Kotlin Host.
//!
//! The Rust layer is a courier here. It takes the `payload` + `signature` the
//! server issued, writes them into `<cyvra.home>/entitlement.json`, and updates
//! that file again whenever the entitlement changes (a revalidation, a plan
//! change, a switch between the online snapshot and the restricted offline
//! lease). It never signs, never edits the payload, and never invents a field.
//!
//! `payload` is stored as a **string** rather than as a nested object. That is
//! deliberate: the string is the exact UTF-8 the server signed, so the Host can
//! verify it byte for byte without either side needing a canonical-JSON scheme.
//! Re-serializing on either end would mean two independent serializers having to
//! agree on whitespace and number formatting - and any disagreement would deny a
//! paying customer. Stored verbatim, there is nothing to disagree about, and any
//! edit fails verification.

use crate::activation::api::SignedSnapshot;
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const SCHEMA: &str = "cyvra.entitlement.v1";
pub const FILE_NAME: &str = "entitlement.json";

#[derive(Debug, Serialize)]
struct Envelope<'a> {
    schema: &'a str,
    #[serde(rename = "issuedAt")]
    issued_at: &'a str,
    /// The exact bytes the server signed, carried through untouched.
    payload: &'a str,
    signature: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExportError {
    /// `cyvra.home` is unset or blank, so there is nowhere to export to.
    HomeUnavailable,
    WriteFailed,
    /// The snapshot the caller handed over is not something the Host could
    /// possibly verify. Refused rather than written.
    Unverifiable,
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExportError::HomeUnavailable => write!(f, "installation root unavailable"),
            ExportError::WriteFailed => write!(f, "entitlement export failed"),
            ExportError::Unverifiable => write!(f, "refusing to export an unverifiable snapshot"),
        }
    }
}

impl std::error::Error for ExportError {}

pub fn entitlement_path(home: &Path) -> PathBuf {
    home.join(FILE_NAME)
}

/// Writes the snapshot to `<cyvra.home>/entitlement.json` atomically.
///
/// An empty payload or an empty signature is refused: exporting a document the
/// Host is guaranteed to reject would only produce a confusing fail-closed
/// licence state later.
pub fn export(
    home: &Path,
    snapshot: &SignedSnapshot,
    issued_at: &str,
) -> Result<PathBuf, ExportError> {
    // Two different causes, told apart deliberately: without an installation
    // root there is nowhere to write (a wiring problem), and an unsigned
    // snapshot would only produce a document the Host is guaranteed to reject
    // (a licensing problem). Collapsing them would make a local fault look
    // like a server defect in the audit trail.
    if home.as_os_str().is_empty() {
        return Err(ExportError::HomeUnavailable);
    }

    if snapshot.payload.is_empty() || snapshot.signature.is_empty() {
        return Err(ExportError::Unverifiable);
    }

    let envelope = Envelope {
        schema: SCHEMA,
        issued_at,
        payload: &snapshot.payload,
        signature: &snapshot.signature,
    };

    let mut bytes = serde_json::to_vec(&envelope).map_err(|_| ExportError::Unverifiable)?;
    bytes.push(b'\n');

    let destination = entitlement_path(home);
    let staging = destination.with_extension("json.tmp");

    std::fs::write(&staging, bytes).map_err(|_| ExportError::WriteFailed)?;
    std::fs::rename(&staging, &destination).map_err(|_| ExportError::WriteFailed)?;

    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> SignedSnapshot {
        SignedSnapshot {
            payload: r#"{"licenseId":"LIC-MOB-2026-00124","scansRemaining":17,"graceLimitSeconds":86400,"offline":{"diagnostics":true,"sanitizeExecute":false,"upgrade":false}}"#.to_string(),
            signature: "c2lnbmF0dXJl".to_string(),
        }
    }

    fn temp_home() -> PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("cyvra-entitlement-{}-{stamp}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn the_exported_document_carries_the_schema_and_the_signed_text_verbatim() {
        let home = temp_home();
        let snap = snapshot();

        export(&home, &snap, "2026-09-30T10:00:00Z").expect("export must succeed");

        let written = std::fs::read_to_string(entitlement_path(&home)).expect("read back");
        let parsed: serde_json::Value = serde_json::from_str(&written).expect("valid JSON");

        assert_eq!(parsed["schema"], SCHEMA);
        assert_eq!(parsed["issuedAt"], "2026-09-30T10:00:00Z");
        assert_eq!(parsed["payload"], snap.payload);
        assert_eq!(parsed["signature"], snap.signature);
    }

    #[test]
    fn the_payload_survives_the_trip_byte_for_byte() {
        let home = temp_home();
        let snap = snapshot();

        export(&home, &snap, "2026-09-30T10:00:00Z").expect("export must succeed");

        let written = std::fs::read_to_string(entitlement_path(&home)).expect("read back");
        let parsed: serde_json::Value = serde_json::from_str(&written).expect("valid JSON");

        // Byte-exactness is what makes the signature verifiable without a
        // canonicalization scheme; this is the property the Host depends on.
        assert_eq!(parsed["payload"].as_str().expect("string payload"), snap.payload);
    }

    #[test]
    fn an_unresolved_installation_root_is_reported_as_such_not_as_a_bad_signature() {
        let nowhere = PathBuf::new();

        assert_eq!(
            export(&nowhere, &snapshot(), "2026-09-30T10:00:00Z"),
            Err(ExportError::HomeUnavailable)
        );
        assert!(
            !entitlement_path(&nowhere).exists(),
            "no export may appear in the working directory"
        );
    }

    #[test]
    fn an_empty_signature_is_refused_instead_of_written() {
        let home = temp_home();
        let mut snap = snapshot();
        snap.signature = String::new();

        assert_eq!(
            export(&home, &snap, "2026-09-30T10:00:00Z"),
            Err(ExportError::Unverifiable)
        );
        assert!(!entitlement_path(&home).exists(), "nothing may be written");
    }

    #[test]
    fn an_empty_payload_is_refused_instead_of_written() {
        let home = temp_home();
        let mut snap = snapshot();
        snap.payload = String::new();

        assert_eq!(
            export(&home, &snap, "2026-09-30T10:00:00Z"),
            Err(ExportError::Unverifiable)
        );
        assert!(!entitlement_path(&home).exists());
    }

    #[test]
    fn overwriting_an_existing_export_replaces_it_whole() {
        let home = temp_home();
        let first = snapshot();
        export(&home, &first, "2026-09-30T10:00:00Z").expect("first export");

        let second = SignedSnapshot {
            payload: r#"{"licenseId":"LIC-MOB-2026-00124","scansRemaining":16}"#.to_string(),
            signature: "bmV3".to_string(),
        };
        export(&home, &second, "2026-09-30T11:00:00Z").expect("second export");

        let written = std::fs::read_to_string(entitlement_path(&home)).expect("read back");
        let parsed: serde_json::Value = serde_json::from_str(&written).expect("valid JSON");
        assert_eq!(parsed["signature"], "bmV3");
        assert!(!written.contains("c2lnbmF0dXJl"), "the old snapshot must be gone");
    }

    #[test]
    fn no_staging_file_is_left_behind() {
        let home = temp_home();
        export(&home, &snapshot(), "2026-09-30T10:00:00Z").expect("export must succeed");
        assert!(!home.join("entitlement.json.tmp").exists());
    }
}
