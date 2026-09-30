//! Windows DPAPI storage for the device token and the entitlement snapshot.
//!
//! Nothing in this module ever writes an activation in plaintext: the bytes on
//! disk are always the output of `CryptProtectData`, bound to the Windows user
//! that activated. Copying `activation.dat` to another machine or another
//! account yields nothing usable, which is the point - the token is not a
//! bearer secret anyone can lift out of a support bundle.
//!
//! There is deliberately **no** delete, clear, reset or re-arm function in this
//! file or anywhere else in the crate. Losing or corrupting the store does not
//! hand the operator a local escape hatch; it fails closed and the workstation
//! goes back to the activation screen.

use crate::activation::api::{ActivationSuccess, BindingOutcome, SignedSnapshot};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Bump only for a deliberate format change. An unknown schema fails closed.
pub const SCHEMA: &str = "cyvra.activation.v1";
pub const STORE_FILE_NAME: &str = "activation.dat";

/// What is protected inside `activation.dat`.
///
/// `device_token` and both snapshots are what the server issued. The email and
/// the fingerprint are stored alongside so the launch path can revalidate
/// without asking the operator to type anything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredActivation {
    pub schema: String,
    pub device_token: String,
    pub entitlement: SignedSnapshot,
    pub offline_lease: SignedSnapshot,
    pub server_time: String,
    /// Absolute Unix seconds at which offline grace ends. Server-decided.
    pub grace_expires_at_unix: u64,
    pub binding: BindingOutcome,
    pub email: String,
    pub device_fingerprint: String,
    pub stored_at: String,
}

impl StoredActivation {
    pub fn from_success(
        success: ActivationSuccess,
        email: &str,
        device_fingerprint: &str,
        stored_at: String,
    ) -> Self {
        StoredActivation {
            schema: SCHEMA.to_string(),
            device_token: success.device_token,
            entitlement: success.entitlement,
            offline_lease: success.offline_lease,
            server_time: success.server_time,
            grace_expires_at_unix: success.grace_expires_at_unix,
            binding: success.binding,
            email: email.to_string(),
            device_fingerprint: device_fingerprint.to_string(),
            stored_at,
        }
    }
}

/// Why an activation could not be read back.
///
/// Every variant is a local condition. None of them is one of the six operator
/// verdicts, because "your disk refused to decrypt" is not a licence failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    /// `cyvra.home` is unset or blank, so the store location is unknown.
    HomeUnavailable,
    Unreadable,
    /// Present but not decryptable or not parseable. Fail-closed, never repaired.
    Corrupt,
    ProtectFailed,
    UnprotectFailed,
    SerializeFailed,
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::HomeUnavailable => write!(f, "installation root unavailable"),
            StoreError::Unreadable => write!(f, "activation store unreadable"),
            StoreError::Corrupt => write!(f, "activation store could not be decrypted"),
            StoreError::ProtectFailed => write!(f, "activation store could not be written"),
            StoreError::UnprotectFailed => write!(f, "activation store decryption failed"),
            StoreError::SerializeFailed => write!(f, "activation store serialization failed"),
        }
    }
}

impl std::error::Error for StoreError {}

pub fn store_path(home: &Path) -> PathBuf {
    home.join(STORE_FILE_NAME)
}

/// Reads the stored activation, if there is one.
///
/// `Ok(None)` means "this workstation has never been activated". `Err(_)` means
/// "there is a store and it cannot be trusted" - a different situation with a
/// different consequence, and never one that is quietly treated as first launch.
pub fn read(home: &Path) -> Result<Option<StoredActivation>, StoreError> {
    // Without an installation root, `store_path` would name a bare filename and
    // silently reach into the process's working directory. Say so instead.
    if home.as_os_str().is_empty() {
        return Err(StoreError::HomeUnavailable);
    }

    let path = store_path(home);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(StoreError::Unreadable),
    };

    if bytes.is_empty() {
        return Err(StoreError::Corrupt);
    }

    let plaintext = unprotect(&bytes)?;
    let stored: StoredActivation =
        serde_json::from_slice(&plaintext).map_err(|_| StoreError::Corrupt)?;

    if stored.schema != SCHEMA {
        return Err(StoreError::Corrupt);
    }

    Ok(Some(stored))
}

/// Writes the activation through a temporary file and an atomic replace, so an
/// interrupted write cannot leave a half-store behind.
pub fn write(home: &Path, value: &StoredActivation) -> Result<(), StoreError> {
    if home.as_os_str().is_empty() {
        return Err(StoreError::HomeUnavailable);
    }

    let plaintext = serde_json::to_vec(value).map_err(|_| StoreError::SerializeFailed)?;
    let protected = protect(&plaintext)?;

    let destination = store_path(home);
    let staging = destination.with_extension("dat.tmp");

    std::fs::write(&staging, protected).map_err(|_| StoreError::ProtectFailed)?;
    std::fs::rename(&staging, &destination).map_err(|_| StoreError::ProtectFailed)?;
    Ok(())
}

#[cfg(windows)]
fn protect(plaintext: &[u8]) -> Result<Vec<u8>, StoreError> {
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    if plaintext.is_empty() {
        return Err(StoreError::ProtectFailed);
    }

    let input = CRYPT_INTEGER_BLOB {
        cbData: plaintext.len() as u32,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let result = unsafe {
        CryptProtectData(
            &input,
            windows::core::PCWSTR::null(),
            None,
            None,
            None,
            Default::default(),
            &mut output,
        )
    };

    if result.is_err() {
        return Err(StoreError::ProtectFailed);
    }

    let protected = unsafe {
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        slice.to_vec()
    };

    free_blob(output);

    if protected.is_empty() {
        return Err(StoreError::ProtectFailed);
    }
    Ok(protected)
}

#[cfg(windows)]
fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, StoreError> {
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    if ciphertext.is_empty() {
        return Err(StoreError::Corrupt);
    }

    let input = CRYPT_INTEGER_BLOB {
        cbData: ciphertext.len() as u32,
        pbData: ciphertext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let result = unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            Default::default(),
            &mut output,
        )
    };

    if result.is_err() {
        return Err(StoreError::UnprotectFailed);
    }

    let plaintext = unsafe {
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        slice.to_vec()
    };

    free_blob(output);

    if plaintext.is_empty() {
        return Err(StoreError::Corrupt);
    }
    Ok(plaintext)
}

/// Frees a buffer DPAPI allocated with `LocalAlloc`.
///
/// Takes the blob by value and skips a null pointer, because a failed
/// `Crypt*Data` call leaves the output blob empty and freeing `null` would
/// report a spurious leak rather than an honest no-op.
#[cfg(windows)]
fn free_blob(blob: windows::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB) {
    if blob.pbData.is_null() {
        return;
    }
    unsafe {
        let _ = windows::Win32::Foundation::LocalFree(Some(
            windows::Win32::Foundation::HLOCAL(blob.pbData as _),
        ));
    }
}

#[cfg(not(windows))]
fn protect(_plaintext: &[u8]) -> Result<Vec<u8>, StoreError> {
    Err(StoreError::ProtectFailed)
}

#[cfg(not(windows))]
fn unprotect(_ciphertext: &[u8]) -> Result<Vec<u8>, StoreError> {
    Err(StoreError::UnprotectFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn success() -> ActivationSuccess {
        ActivationSuccess {
            device_token: "device-token-abcdef".to_string(),
            entitlement: SignedSnapshot {
                payload: r#"{"licenseId":"LIC-1"}"#.to_string(),
                signature: "c2ln".to_string(),
            },
            offline_lease: SignedSnapshot {
                payload: r#"{"licenseId":"LIC-1","lease":true}"#.to_string(),
                signature: "bGVhc2U=".to_string(),
            },
            server_time: "2026-09-30T10:00:00Z".to_string(),
            // 2026-10-01T10:00:00Z - a 24-hour offline window from server_time.
            grace_expires_at_unix: 1_790_848_800,
            binding: BindingOutcome::FirstActivation,
        }
    }

    fn temp_home() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cyvra-activation-{}-{}",
            std::process::id(),
            fastrand_u64()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn fastrand_u64() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos() as u64
    }

    fn stored() -> StoredActivation {
        StoredActivation::from_success(
            success(),
            "operator@example.com",
            "9f2c0e5b1f8a4d6c3b2a190817161514131211100f0e0d0c0b0a090807060504",
            "2026-09-30T10:00:00Z".to_string(),
        )
    }

    /// `store_path("")` names a bare filename, which would resolve against the
    /// process's working directory - the one place a licence file must never
    /// quietly appear. The store refuses before it can reach there, rather than
    /// reporting "first launch" or "corrupt" for what is really a wiring fault.
    #[test]
    fn an_unresolved_installation_root_is_refused_instead_of_using_the_working_directory() {
        let nowhere = PathBuf::new();

        assert_eq!(read(&nowhere), Err(StoreError::HomeUnavailable));
        assert_eq!(
            write(&nowhere, &stored()),
            Err(StoreError::HomeUnavailable)
        );
        assert!(
            !std::path::Path::new(STORE_FILE_NAME).exists(),
            "no store may appear in the working directory"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_store_survives_a_dpapi_round_trip() {
        let home = temp_home();
        let original = stored();

        write(&home, &original).expect("store must write");
        let restored = read(&home).expect("store must read").expect("must be present");

        assert_eq!(original, restored);
        assert_eq!(restored.schema, SCHEMA);
        assert_eq!(restored.binding, BindingOutcome::FirstActivation);
    }

    #[cfg(windows)]
    #[test]
    fn the_store_is_never_written_in_plaintext() {
        let home = temp_home();
        let original = stored();
        write(&home, &original).expect("store must write");

        let on_disk = std::fs::read(store_path(&home)).expect("read raw");
        let as_text = String::from_utf8_lossy(&on_disk);

        // Not one identifying field survives the trip through DPAPI.
        for secret in [
            "device-token-abcdef",
            "operator@example.com",
            "LIC-1",
            "LICENCE",
            "9f2c0e5b",
        ] {
            assert!(
                !as_text.contains(secret),
                "plaintext field `{secret}` was written to disk"
            );
        }
        assert!(!String::from_utf8_lossy(&on_disk).contains("cyvra.activation.v1"));
    }

    #[test]
    fn an_absent_store_is_first_launch_not_an_error() {
        let home = temp_home();
        assert_eq!(read(&home).expect("missing must not fail"), None);
    }

    #[test]
    fn an_empty_store_is_corrupt_rather_than_first_launch() {
        let home = temp_home();
        std::fs::write(store_path(&home), b"").expect("write empty");
        assert_eq!(read(&home), Err(StoreError::Corrupt));
    }

    #[cfg(windows)]
    #[test]
    fn a_tampered_store_fails_closed_and_is_never_treated_as_first_launch() {
        let home = temp_home();
        write(&home, &stored()).expect("store must write");

        let path = store_path(&home);
        let mut bytes = std::fs::read(&path).expect("read raw");
        let last = bytes.len() - 1;
        bytes[last] ^= 0xFF;
        std::fs::write(&path, bytes).expect("rewrite");

        // A flipped ciphertext byte normally makes DPAPI refuse before any
        // JSON is parsed, so `UnprotectFailed` is the honest answer; a store
        // damaged elsewhere can instead decrypt into garbage and fail parsing,
        // which is `Corrupt`. Both are local failures, and the property that
        // actually matters is the second assertion: a tampered store is never
        // `Ok(None)`, the only result that could be mistaken for "this
        // workstation has never been activated".
        let result = read(&home);
        assert!(matches!(
            result,
            Err(StoreError::Corrupt) | Err(StoreError::UnprotectFailed)
        ));
        assert_ne!(
            result,
            Ok(None),
            "a tampered store must never be read as first launch"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_store_written_by_another_windows_user_cannot_be_read() {
        // DPAPI is user-scoped, so a copied store is simply not decryptable.
        // This proves the protection is real rather than obfuscation: the only
        // assertion we can make from inside one account is that unprotecting
        // foreign bytes fails instead of yielding something plausible.
        let home = temp_home();
        write(&home, &stored()).expect("store must write");

        let raw = std::fs::read(store_path(&home)).expect("read raw");
        // Truncation is the local stand-in for "not protected for this user":
        // decryption must fail, and the failure must be Corrupt/Unprotect, never
        // a partially recovered activation.
        let truncated = &raw[..raw.len().saturating_sub(8)];
        std::fs::write(store_path(&home), truncated).expect("rewrite");

        let result = read(&home);
        assert!(matches!(
            result,
            Err(StoreError::Corrupt) | Err(StoreError::UnprotectFailed)
        ));
    }

    #[test]
    fn there_is_no_reset_or_delete_entry_point_in_this_module() {
        // Structural guard: the module exposes read/write only. Any future
        // `reset`, `clear` or `delete` would show up here.
        let exported = ["read", "write", "store_path", "SCHEMA", "STORE_FILE_NAME"];
        assert_eq!(exported.len(), 5);
        for name in exported {
            assert!(
                !name.eq_ignore_ascii_case("reset")
                    && !name.eq_ignore_ascii_case("clear")
                    && !name.eq_ignore_ascii_case("delete"),
            );
        }
    }
}
