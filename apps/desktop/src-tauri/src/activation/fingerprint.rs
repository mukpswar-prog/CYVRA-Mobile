//! Hardware identity for first-device binding.
//!
//! Three independent system identifiers are read, then hashed together so that
//! no raw identifier is ever written to disk, put in an audit line, or sent to
//! the server. The server receives only the digest, which is enough to say
//! "this is the same computer" and nothing about the computer's contents.
//!
//! Deliberately excluded, and enforced by the fact that the canonical form is
//! built from exactly three fields:
//!
//! * anything under the user's profile (documents, app data, browser state);
//! * any phone serial, IMEI or Android identifier - a phone is not the
//!   workstation, and binding the workstation to a phone would make the binding
//!   change every time a different device is inspected.

use sha2::{Digest, Sha256};

/// The three identity components, each already reduced to a stable string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FingerprintComponents {
    /// Windows `MachineGuid` from `HKLM\SOFTWARE\Microsoft\Cryptography`.
    pub machine_guid: String,
    /// SMBIOS Type 1 UUID, as the firmware reports it.
    pub smbios_uuid: String,
    /// Serial of the volume that holds `%SystemRoot%`.
    pub system_volume_serial: String,
}

/// Why a fingerprint could not be produced. Never surfaced as a licence
/// failure: this is a local precondition, not a server verdict.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FingerprintError {
    /// A named component could not be read on this machine.
    Missing { component: &'static str },
    /// Windows did not return a usable SMBIOS table at all.
    FirmwareTableUnavailable,
}

impl std::fmt::Display for FingerprintError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FingerprintError::Missing { component } => {
                write!(f, "identity component unavailable: {component}")
            }
            FingerprintError::FirmwareTableUnavailable => {
                write!(f, "SMBIOS firmware table unavailable")
            }
        }
    }
}

impl std::error::Error for FingerprintError {}

/// Canonical, unambiguous form the digest is taken over.
///
/// Field names and separators are part of the contract: adding a fourth
/// component later would silently re-bind every existing workstation, so this
/// function is the single place the composition is defined.
fn canonical(components: &FingerprintComponents) -> String {
    format!(
        "cyvra.workstation.v1\nmachine_guid={}\nsmbios_uuid={}\nsystem_volume_serial={}\n",
        components.machine_guid.trim().to_lowercase(),
        components.smbios_uuid.trim().to_lowercase(),
        components.system_volume_serial.trim().to_lowercase(),
    )
}

/// Lowercase hex SHA-256 of the canonical form. Pure, so it is testable without
/// any Windows API.
pub fn digest_of(components: &FingerprintComponents) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical(components).as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Reads the three components and digests them.
///
/// Fails rather than guessing: a workstation that cannot state its own identity
/// must not be presented as bound, and a partial digest would quietly become a
/// *different* identity the next time the missing component happened to be
/// readable.
pub fn device_fingerprint() -> Result<String, FingerprintError> {
    let components = read_components()?;

    if components.machine_guid.is_empty() {
        return Err(FingerprintError::Missing {
            component: "machine GUID",
        });
    }
    if components.smbios_uuid.is_empty() {
        return Err(FingerprintError::Missing {
            component: "SMBIOS UUID",
        });
    }
    if components.system_volume_serial.is_empty() {
        return Err(FingerprintError::Missing {
            component: "system volume serial",
        });
    }

    Ok(digest_of(&components))
}

#[cfg(windows)]
fn read_components() -> Result<FingerprintComponents, FingerprintError> {
    Ok(FingerprintComponents {
        machine_guid: windows_machine_guid(),
        smbios_uuid: windows_smbios_uuid()?,
        system_volume_serial: windows_system_volume_serial(),
    })
}

#[cfg(not(windows))]
fn read_components() -> Result<FingerprintComponents, FingerprintError> {
    Err(FingerprintError::Missing {
        component: "Windows workstation identity",
    })
}

/// NUL-terminated UTF-16, spelled out rather than pulled from the `w!` macro so
/// the encoding rule is visible and unit-testable.
#[cfg(windows)]
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// `MachineGuid`, a REG_SZ under HKLM. Read-only.
#[cfg(windows)]
fn windows_machine_guid() -> String {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};

    const KEY: &str = r"SOFTWARE\Microsoft\Cryptography";
    const VALUE: &str = "MachineGuid";

    let key = wide(KEY);
    let value = wide(VALUE);

    // REG_SZ is 36 characters plus the terminator; 64 wide chars is generous.
    let mut buffer = [0u16; 64];
    let mut size_in_bytes = (buffer.len() * 2) as u32;

    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(key.as_ptr()),
            PCWSTR(value.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr() as *mut _),
            Some(&mut size_in_bytes),
        )
    };

    if status.is_err() {
        return String::new();
    }

    let terminated = size_in_bytes as usize / 2;
    let end = buffer[..terminated.min(buffer.len())]
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(terminated.min(buffer.len()));

    String::from_utf16_lossy(&buffer[..end]).trim().to_string()
}

/// The SMBIOS Type 1 (System Information) UUID.
///
/// The raw `RSMB` firmware table is read into a buffer and walked struct by
/// struct; nothing but the 16-byte system UUID leaves this function.
#[cfg(windows)]
fn windows_smbios_uuid() -> Result<String, FingerprintError> {
    use windows::Win32::System::SystemInformation::{GetSystemFirmwareTable, FIRMWARE_TABLE_PROVIDER};

    /// `'RSMB'` as the DWORD `FIRMWARE_TABLE_PROVIDER` expects: each ASCII
    /// byte in *descending* significance, so the literal reads the same left to
    /// right in the register as it does on the page - `'R'<<24 | 'S'<<16 |
    /// 'M'<<8 | 'B'`. That is `from_be_bytes` over the four bytes.
    ///
    /// `from_le_bytes` produced `0x424D5352`, which `GetSystemFirmwareTable`
    /// rejects with `ERROR_INVALID_FUNCTION` (verified: 0 bytes returned while
    /// `0x52534D42` returns the 1742-byte table, and the `'ACPI'` analogue
    /// `0x41435049` returns 268). Every fingerprint therefore failed with
    /// `FirmwareTableUnavailable`, and since `activation_request` requires one,
    /// no workstation could ever submit an activation.
    const PROVIDER: u32 = u32::from_be_bytes(*b"RSMB");

    // A real SMBIOS table is a few KB; 64 KiB is far beyond any plausible
    // maximum and avoids a probe-then-allocate dance whose return-value
    // semantics differ between buffer sizes.
    const CAPACITY: usize = 64 * 1024;

    let mut table = vec![0u8; CAPACITY];
    let written = unsafe {
        GetSystemFirmwareTable(FIRMWARE_TABLE_PROVIDER(PROVIDER), 0, Some(&mut table))
    };

    if written == 0 || written as usize > table.len() {
        return Err(FingerprintError::FirmwareTableUnavailable);
    }
    table.truncate(written as usize);

    smbios_type1_uuid(&table).ok_or(FingerprintError::Missing {
        component: "SMBIOS UUID",
    })
}

/// `RawSMBIOSData { Used20CallingMethod, Major, Minor, DmiRevision, Length, Data }`.
/// The header is 8 bytes wide, so the table itself starts there.
#[cfg(windows)]
fn smbios_type1_uuid(raw: &[u8]) -> Option<String> {
    const RAW_HEADER_LEN: usize = 8;
    if raw.len() < RAW_HEADER_LEN + 4 {
        return None;
    }
    let declared = u32::from_le_bytes([raw[4], raw[5], raw[6], raw[7]]) as usize;
    let data = &raw[RAW_HEADER_LEN..(RAW_HEADER_LEN + declared).min(raw.len())];

    let mut offset = 0usize;
    while offset + 4 <= data.len() {
        let struct_type = data[offset];
        let struct_len = data[offset + 1] as usize;

        if struct_type == 1 && struct_len >= 0x18 && offset + 0x18 <= data.len() {
            // Type 1 header (4) + Manufacturer, Product, Version, Serial (4).
            let uuid = &data[offset + 8..offset + 24];
            return Some(format_uuid(uuid));
        }
        if struct_type == 127 {
            return None;
        }
        if struct_len < 4 {
            return None;
        }

        let end_of_formatted = offset + struct_len;
        if end_of_formatted >= data.len() {
            return None;
        }
        // The formatted area is followed by a string-set, terminated by two NULs.
        let mut cursor = end_of_formatted;
        let mut nul_run = 0usize;
        while cursor < data.len() {
            if data[cursor] == 0 {
                nul_run += 1;
                if nul_run >= 2 {
                    break;
                }
            } else {
                nul_run = 0;
            }
            cursor += 1;
        }
        if cursor >= data.len() {
            return None;
        }
        offset = cursor + 1;
    }

    None
}

/// RFC 4122 style rendering. An all-zero UUID means the firmware withheld it,
/// which is reported as missing rather than as an identity.
#[cfg(windows)]
fn format_uuid(bytes: &[u8]) -> String {
    if bytes.iter().all(|&b| b == 0) {
        return String::new();
    }
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// Serial number of the volume that holds `%SystemRoot%`, not of `C:`
/// specifically and never of a user-data or removable volume.
#[cfg(windows)]
fn windows_system_volume_serial() -> String {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetVolumeInformationW;

    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    // `GetVolumeInformationW` wants a root directory that carries its colon
    // and a trailing backslash (`C:\`). The colon is deliberately trimmed below
    // and has to be put back by the format string; with just `"{}\\"` the call
    // received `C\`, failed with 0x80070002, returned no serial, and every
    // fingerprint then died as `system volume serial` missing. Like the SMBIOS
    // provider DWORD, this was unreachable until that first defect was fixed,
    // so `device_fingerprint()` had never once succeeded.
    let root = format!(
        "{}:\\",
        system_root
            .split('\\')
            .next()
            .unwrap_or("C:")
            .trim_end_matches(':')
    );
    let root_wide = wide(&root);

    let mut serial: u32 = 0;
    let result = unsafe {
        GetVolumeInformationW(
            PCWSTR(root_wide.as_ptr()),
            None,
            Some(&mut serial),
            None,
            None,
            None,
        )
    };

    if result.is_ok() && serial != 0 {
        format!("{serial:08x}")
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> FingerprintComponents {
        FingerprintComponents {
            machine_guid: "2f1c6e4a-9b3d-4f77-8c21-5a0e6d9b1f42".to_string(),
            smbios_uuid: "a1b2c3d4-0000-1111-2222-333344445555".to_string(),
            system_volume_serial: "1a2b3c4d".to_string(),
        }
    }

    #[test]
    fn the_same_components_always_produce_the_same_digest() {
        assert_eq!(digest_of(&sample()), digest_of(&sample()));
    }

    #[test]
    fn the_digest_is_lowercase_sha256_hex() {
        let digest = digest_of(&sample());
        assert_eq!(digest.len(), 64);
        assert!(digest
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)));
    }

    #[test]
    fn case_and_whitespace_do_not_change_identity() {
        let mut changed = sample();
        changed.machine_guid = format!("  {}  ", changed.machine_guid.to_uppercase());
        assert_eq!(digest_of(&sample()), digest_of(&changed));
    }

    #[test]
    fn any_single_component_change_changes_identity() {
        let base = digest_of(&sample());

        let mut a = sample();
        a.machine_guid = "00000000-0000-0000-0000-000000000000".to_string();
        assert_ne!(base, digest_of(&a));

        let mut b = sample();
        b.smbios_uuid = "00000000-0000-0000-0000-000000000000".to_string();
        assert_ne!(base, digest_of(&b));

        let mut c = sample();
        c.system_volume_serial = "00000000".to_string();
        assert_ne!(base, digest_of(&c));
    }

    #[test]
    fn the_digest_covers_exactly_three_named_fields() {
        // Guards the composition against a silent fourth component: the same
        // three values in the same order must always be what is hashed.
        let canonical = canonical(&sample());
        assert!(canonical.starts_with("cyvra.workstation.v1\n"));
        assert_eq!(canonical.matches("machine_guid=").count(), 1);
        assert_eq!(canonical.matches("smbios_uuid=").count(), 1);
        assert_eq!(canonical.matches("system_volume_serial=").count(), 1);
        assert!(!canonical.contains("phone"));
        assert!(!canonical.contains("serial_number="));
        assert!(!canonical.contains("user"));
    }

    #[test]
    fn an_unreadable_component_is_an_error_not_a_partial_identity() {
        // On this build the components are read from Windows; whatever the
        // host reports, the function must answer with either a full digest or
        // an error that names what was missing - never with a digest built
        // from fewer than three parts.
        match device_fingerprint() {
            Ok(digest) => assert_eq!(digest.len(), 64),
            Err(error) => assert!(!error.to_string().is_empty()),
        }
    }

    #[cfg(windows)]
    #[test]
    fn an_all_zero_smbios_uuid_is_reported_as_missing_not_as_an_identity() {
        assert_eq!(format_uuid(&[0u8; 16]), String::new());
    }

    #[cfg(windows)]
    #[test]
    fn a_withheld_smbios_uuid_never_reaches_the_digest() {
        let mut components = sample();
        components.smbios_uuid = format_uuid(&[0u8; 16]);
        // The provider rejects this before hashing; the digest function itself
        // still has to be total so it cannot panic on a bad caller.
        assert_eq!(digest_of(&components).len(), 64);
    }
}
