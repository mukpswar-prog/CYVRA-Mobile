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
use crate::ledger;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const SCHEMA: &str = "cyvra.entitlement.v1";
pub const FILE_NAME: &str = "entitlement.json";

/// One scan this workstation has actually spent.
///
/// It sits **beside** `payload`, never inside it. `payload` is byte-exact
/// server-signed text - editing it would break Ed25519 verification and deny a
/// paying customer outright - so local consumption is recorded as a sibling
/// field that the signature does not cover and does not need to: it can only
/// ever *reduce* what the server granted, never widen it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Debit {
    pub seq: u64,
    /// UTC ISO-8601, from the caller's injected clock.
    pub at: String,
    /// The certificate this spend settled. The idempotency key.
    pub subject: String,
    pub prev: String,
    pub hash: String,
}

impl Debit {
    fn body(&self) -> DebitBody<'_> {
        DebitBody {
            seq: self.seq,
            at: &self.at,
            subject: &self.subject,
            prev: &self.prev,
        }
    }

    fn compute_hash(&self) -> Result<String, ExportError> {
        hash_of(&self.body())
    }
}

#[derive(Serialize)]
struct DebitBody<'a> {
    seq: u64,
    at: &'a str,
    subject: &'a str,
    prev: &'a str,
}

fn hash_of(body: &DebitBody<'_>) -> Result<String, ExportError> {
    let bytes = serde_json::to_vec(body).map_err(|_| ExportError::WriteFailed)?;
    Ok(hex_of(&Sha256::digest(bytes)))
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Debug, Serialize)]
struct Envelope<'a> {
    schema: &'a str,
    #[serde(rename = "issuedAt")]
    issued_at: &'a str,
    /// The exact bytes the server signed, carried through untouched.
    payload: &'a str,
    signature: &'a str,
    /// Omitted entirely when nothing has been spent, so an untouched
    /// installation ships the same document it always did.
    #[serde(default, skip_serializing_if = "no_debits")]
    debits: &'a [Debit],
}

/// Serde hands `skip_serializing_if` a reference to the field, which is itself
/// already a reference here - hence the doubled `&&`.
fn no_debits(debits: &&[Debit]) -> bool {
    debits.is_empty()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExportError {
    /// `cyvra.home` is unset or blank, so there is nowhere to export to.
    HomeUnavailable,
    WriteFailed,
    /// The snapshot the caller handed over is not something the Host could
    /// possibly verify. Refused rather than written.
    Unverifiable,
    /// There is no entitlement document to settle a scan against.
    ///
    /// Reaching this means a certificate was produced without a licence ever
    /// being exported, which the protocol does not admit; it is reported
    /// rather than assumed impossible so a wiring fault cannot masquerade as a
    /// successful debit.
    NoSnapshot,
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExportError::HomeUnavailable => write!(f, "installation root unavailable"),
            ExportError::WriteFailed => write!(f, "entitlement export failed"),
            ExportError::Unverifiable => write!(f, "refusing to export an unverifiable snapshot"),
            ExportError::NoSnapshot => write!(f, "no entitlement snapshot to debit against"),
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

    /*
     * Local consumption survives a re-export - but only while the server keeps
     * saying the same thing.
     *
     * An unchanged `signature` means the same statement, so what this machine
     * already spent against it still stands and the journal is carried
     * forward. A *new* signature is a new statement whose counts the server
     * issued knowing everything it knows, so the journal starts again rather
     * than double-counting a balance the server has already settled.
     *
     * Read and written under the same lock [record_debit] uses: re-exporting
     * while a scan settles would otherwise drop one or the other.
     */
    let _guard = ledger::file_lock()
        .lock()
        .map_err(|_| ExportError::WriteFailed)?;

    let debits = match read_document(home) {
        Ok(Some(document)) if document.signature == snapshot.signature => document.debits,
        _ => Vec::new(),
    };

    let envelope = Envelope {
        schema: SCHEMA,
        issued_at,
        payload: &snapshot.payload,
        signature: &snapshot.signature,
        debits: &debits,
    };

    write_envelope(home, &envelope)
}

/// Appends one settlement to `<cyvra.home>/entitlement.json`.
///
/// Idempotent by [subject]: replaying the same certificate returns the entry
/// already on file rather than spending twice, which is what makes a retried
/// GET_FINAL_REPORT safe. The signed `payload` and `signature` are copied
/// through untouched, so the Host's verification is unaffected.
///
/// `at` comes from the caller's injected clock - this module never reads one.
pub fn record_debit(
    home: &Path,
    subject: &str,
    at: &str,
) -> Result<Debit, ExportError> {
    if home.as_os_str().is_empty() {
        return Err(ExportError::HomeUnavailable);
    }

    /*
     * Taken before the read, not after it: this is a read-modify-write of a
     * shared file, and two certificates settling at the same moment would each
     * otherwise see the other's spend as absent and drop it on the floor.
     */
    let _guard = ledger::file_lock()
        .lock()
        .map_err(|_| ExportError::WriteFailed)?;

    let document = read_document(home)?.ok_or(ExportError::NoSnapshot)?;

    let mut debits = document.debits;
    if let Some(existing) = debits.iter().find(|debit| debit.subject == subject) {
        return Ok(existing.clone());
    }

    let (seq, prev) = match debits.last() {
        Some(last) => (last.seq.saturating_add(1), last.hash.clone()),
        None => (1, ledger::GENESIS.to_string()),
    };

    let mut entry = Debit {
        seq,
        at: at.to_string(),
        subject: subject.to_string(),
        prev,
        hash: String::new(),
    };
    entry.hash = entry.compute_hash()?;
    debits.push(entry.clone());

    let envelope = Envelope {
        schema: SCHEMA,
        issued_at: &document.issued_at,
        payload: &document.payload,
        signature: &document.signature,
        debits: &debits,
    };

    write_envelope(home, &envelope)?;

    Ok(entry)
}

/// What a previously written document held.
struct Document {
    issued_at: String,
    payload: String,
    signature: String,
    debits: Vec<Debit>,
}

/// Which of the two server-signed snapshots the Host was actually handed.
///
/// `Some(true)` when `entitlement.json` currently carries the restricted
/// offline lease whose signature is [offline_signature], `Some(false)` when it
/// carries some other (live) snapshot, and `None` when the comparison could
/// not be made at all.
///
/// The signature is the whole answer because the signature is the whole
/// difference: the Host is handed either the full entitlement the server
/// signed or the restricted lease it signed alongside it, and which of the two
/// is on disk is exactly whether this workstation is living on grace.
pub fn on_offline_lease(home: &Path, offline_signature: &str) -> Option<bool> {
    read_document(home)
        .ok()?
        .map(|document| document.signature == offline_signature)
}

fn read_document(home: &Path) -> Result<Option<Document>, ExportError> {
    let path = entitlement_path(home);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(ExportError::WriteFailed),
    };

    let value: serde_json::Value =
        serde_json::from_str(text.trim()).map_err(|_| ExportError::WriteFailed)?;

    Ok(Some(Document {
        issued_at: value
            .get("issuedAt")
            .and_then(|it| it.as_str())
            .unwrap_or_default()
            .to_string(),
        payload: value
            .get("payload")
            .and_then(|it| it.as_str())
            .unwrap_or_default()
            .to_string(),
        signature: value
            .get("signature")
            .and_then(|it| it.as_str())
            .unwrap_or_default()
            .to_string(),
        debits: value
            .get("debits")
            .and_then(|it| it.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| serde_json::from_value(item.clone()).ok())
                    .collect()
            })
            .unwrap_or_default(),
    }))
}

fn write_envelope(home: &Path, envelope: &Envelope<'_>) -> Result<PathBuf, ExportError> {
    let mut bytes = serde_json::to_vec(envelope).map_err(|_| ExportError::Unverifiable)?;
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

    // -----------------------------------------------------------------------
    // §14 debit journal
    // -----------------------------------------------------------------------

    fn parsed(home: &Path) -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(entitlement_path(home)).expect("read back"))
            .expect("valid JSON")
    }

    #[test]
    fn an_untouched_entitlement_carries_no_debits_key_at_all() {
        let home = temp_home();
        export(&home, &snapshot(), "2026-09-30T10:00:00Z").expect("export");

        // Absent rather than empty: an installation that has spent nothing
        // must produce byte-for-byte the document it produced before §14
        // existed, so an upgrade cannot be mistaken for a change in licence.
        assert!(
            parsed(&home).get("debits").is_none(),
            "no debits key may appear before anything is spent"
        );
    }

    #[test]
    fn settling_a_scan_records_it_beside_the_signed_payload() {
        let home = temp_home();
        export(&home, &snapshot(), "2026-09-30T10:00:00Z").expect("export");

        let debit = record_debit(&home, "CYVRA-R1-2026-ABCDEF", "2026-09-30T11:00:00Z")
            .expect("settle");
        assert_eq!(debit.seq, 1);
        assert_eq!(debit.prev, ledger::GENESIS);

        let doc = parsed(&home);
        // The signature and its payload must be untouched, or the Host's
        // Ed25519 check fails and a paying customer is denied outright.
        assert_eq!(doc["payload"], snapshot().payload);
        assert_eq!(doc["signature"], snapshot().signature);
        assert_eq!(doc["debits"].as_array().expect("array").len(), 1);
        assert_eq!(doc["debits"][0]["subject"], "CYVRA-R1-2026-ABCDEF");
    }

    #[test]
    fn settling_the_same_certificate_twice_spends_once() {
        let home = temp_home();
        export(&home, &snapshot(), "2026-09-30T10:00:00Z").expect("export");

        let first = record_debit(&home, "CYVRA-R1-2026-ABCDEF", "2026-09-30T11:00:00Z").unwrap();
        let second =
            record_debit(&home, "CYVRA-R1-2026-ABCDEF", "2026-09-30T11:00:09Z").unwrap();

        assert_eq!(
            first, second,
            "a replay must return the entry already on file, not a new one"
        );
        assert_eq!(
            parsed(&home)["debits"].as_array().expect("array").len(),
            1,
            "exactly one spend"
        );
    }

    #[test]
    fn two_certificates_chain_from_each_other() {
        let home = temp_home();
        export(&home, &snapshot(), "2026-09-30T10:00:00Z").expect("export");

        let first = record_debit(&home, "CERT-ONE", "2026-09-30T11:00:00Z").unwrap();
        let second = record_debit(&home, "CERT-TWO", "2026-09-30T12:00:00Z").unwrap();

        assert_eq!(first.seq, 1);
        assert_eq!(second.seq, 2);
        assert_eq!(second.prev, first.hash);
    }

    #[test]
    fn a_re_export_under_the_same_signature_carries_the_journal_forward() {
        let home = temp_home();
        let snap = snapshot();
        export(&home, &snap, "2026-09-30T10:00:00Z").expect("export");
        record_debit(&home, "CERT-ONE", "2026-09-30T11:00:00Z").unwrap();

        // Grace re-entry re-exports the *same* server statement. Dropping the
        // journal here would hand the customer back a scan they had spent.
        export(&home, &snap, "2026-09-30T13:00:00Z").expect("re-export");

        assert_eq!(
            parsed(&home)["debits"].as_array().expect("array").len(),
            1,
            "consumption against an unchanged statement must survive"
        );
    }

    #[test]
    fn a_new_server_signature_starts_the_journal_again() {
        let home = temp_home();
        export(&home, &snapshot(), "2026-09-30T10:00:00Z").expect("export");
        record_debit(&home, "CERT-ONE", "2026-09-30T11:00:00Z").unwrap();

        let renewed = SignedSnapshot {
            payload: r#"{"licenseId":"LIC-MOB-2026-00124","scansRemaining":25}"#.to_string(),
            signature: "cmVuZXdlZA".to_string(),
        };
        export(&home, &renewed, "2026-09-30T14:00:00Z").expect("renew");

        // The server's fresh counts already account for everything it knows;
        // keeping the old journal would charge for a scan twice.
        assert!(
            parsed(&home).get("debits").is_none(),
            "a new statement supersedes local consumption"
        );
    }

    #[test]
    fn settling_without_an_export_is_refused_rather_than_invented() {
        let home = temp_home();

        assert_eq!(
            record_debit(&home, "CERT-ONE", "2026-09-30T11:00:00Z"),
            Err(ExportError::NoSnapshot)
        );
        assert!(!entitlement_path(&home).exists());
    }

    #[test]
    fn an_unresolved_root_cannot_be_settled() {
        assert_eq!(
            record_debit(&PathBuf::new(), "CERT-ONE", "2026-09-30T11:00:00Z"),
            Err(ExportError::HomeUnavailable)
        );
    }

    #[test]
    fn no_staging_file_survives_a_settlement() {
        let home = temp_home();
        export(&home, &snapshot(), "2026-09-30T10:00:00Z").expect("export");
        record_debit(&home, "CERT-ONE", "2026-09-30T11:00:00Z").unwrap();

        assert!(!home.join("entitlement.json.tmp").exists());
        assert!(entitlement_path(&home).exists());
    }

    // -----------------------------------------------------------------------
    // Which lease the Host was handed
    // -----------------------------------------------------------------------

    #[test]
    fn the_lease_in_force_is_readable_from_the_export_itself() {
        let home = temp_home();
        let restricted = SignedSnapshot {
            payload: r#"{"licenseId":"LIC-MOB-2026-00124","lease":true}"#.to_string(),
            signature: "offline-lease-signature".to_string(),
        };
        export(&home, &restricted, "2026-09-30T10:00:00Z").expect("export");

        assert_eq!(
            on_offline_lease(&home, "offline-lease-signature"),
            Some(true),
            "the file holds exactly the restricted lease, so the workstation is on grace"
        );
        assert_eq!(
            on_offline_lease(&home, "full-entitlement-signature"),
            Some(false),
            "the file holds some other snapshot, so it is not on grace"
        );
    }

    #[test]
    fn a_comparison_that_cannot_be_made_declines_to_choose_a_side() {
        let home = temp_home();

        assert_eq!(
            on_offline_lease(&home, "offline-lease-signature"),
            None,
            "no document is not an answer to which document it is"
        );
    }
}
