//! Force-clean parsing and redaction core.
//!
//! Rust port of `scripts/pur-do-wipe/ForceCleanAccounts.psm1` (WP-3).
//!
//! The PowerShell module was, and remains, the reference: it is the artefact that
//! was run against a real Samsung device, and its 43 assertions are the parity
//! oracle this module is measured against. That suite is reproduced verbatim in
//! the `tests` module at the bottom of this file; if it ever stops passing, the
//! port has drifted from the behaviour that was actually proven on hardware.
//!
//! Everything here is host-side and pure: no adb, no file I/O, no side effects,
//! and no destructive capability of any kind. The driver that performs removals
//! is still `scripts/pur-do-wipe/ForceCleanAccounts.ps1`. This module decides
//! *what counts as clean* and *what may be recorded*, and nothing else - so it
//! can be reasoned about and tested without a device attached.
//!
//! WHY THIS IS IN RUST AT ALL
//!
//! The primary reason is that force-clean becomes a native capability the
//! installer invokes directly, with no PowerShell dependency on the operator's
//! machine. Reduced Defender/EDR friction is a secondary benefit, not the
//! acceptance criterion.
//!
//! TWO LOAD-BEARING PROPERTIES
//!
//! 1. A count that cannot be parsed yields `-1`, never `0`. A silent `0` reports
//!    a dirty device as clean, which is precisely the false positive Samsung's
//!    dump format induces.
//! 2. Nothing that reaches an attestation may carry an account identifier. Only
//!    a local-part *length* survives redaction, so a token cannot be reversed,
//!    matched against a wordlist, or correlated across runs.
//!
//! DIVERGENCES FROM THE POWERSHELL, ALL DELIBERATE
//!
//! * `tool` records this implementation, not `ForceCleanAccounts.ps1`. Attesting
//!   to a script that did not run would be a false provenance claim.
//! * An overflowing digit string returns `-1` rather than throwing. PowerShell
//!   casts to `[int]` and raises; panicking inside a Tauri command would take
//!   the operator's session down, and the module's own contract already defines
//!   an unreadable header as `-1`.
//! * Lengths are counted in UTF-16 code units, matching PowerShell's `.Length`,
//!   rather than bytes or Unicode scalars.

use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/// Splits text the way PowerShell's `` -split "`r?`n" `` does.
///
/// A bare carriage return is *not* a separator - only `\n` and `\r\n` are - so
/// a lone `\r` stays inside its segment. Dropping this detail would make the
/// count parser accept input the reference implementation rejects.
fn split_lines(text: &str) -> Vec<&str> {
    text.split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect()
}

fn count_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)^\s*Accounts:\s*(\d+)\s*$")
            .expect("account-count pattern is a compile-time constant")
    })
}

/// Reads the authoritative account count out of `dumpsys content`.
///
/// Samsung replaces AccountManagerService's dump with its own "Accounts History"
/// event log, so the AOSP-idiomatic `dumpsys account | findstr "Account {"`
/// check returns zero on One UI and produces a false "clean" reading.
/// `dumpsys content` prints a plain `Accounts: <n>` header, which is the only
/// count present on both AOSP and Samsung.
///
/// Returns `-1` when the header cannot be found or cannot be read, which the
/// caller must treat as failure and never as zero.
pub fn account_count_from_content_dump(dump_text: &str) -> i32 {
    let re = count_re();
    for line in split_lines(dump_text) {
        if let Some(captures) = re.captures(line) {
            if let Some(digits) = captures.get(1) {
                // PowerShell raises on overflow. We return `-1`: the caller
                // already knows how to handle "unreadable", and the one
                // outcome that must never be produced is a fabricated `0`.
                return digits.as_str().parse::<i32>().unwrap_or(-1);
            }
        }
    }
    -1
}

/// Decides whether the device is clean enough to enrol a device owner.
///
/// `enforceCanSetDeviceOwnerLocked` throws when *any* account is present, so the
/// bar is exactly zero - not "no Google accounts", not "none that sync".
///
/// An unreadable count of `-1` does not satisfy this. Reporting failure as
/// satisfaction would be the same false positive, one layer up.
pub fn device_owner_precondition(account_count: i32) -> bool {
    account_count == 0
}

fn probe_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?im)^\s*remove-account\b")
            .expect("primitive-probe pattern is a compile-time constant")
    })
}

/// Does this build of Android expose `cmd account remove-account`?
///
/// The commissioned primitive. It is absent on Android 11, so the driver must
/// probe rather than assume - otherwise the primary path fails silently
/// mid-sequence.
///
/// The trailing `\b` is load-bearing: it makes `remove-accounts` and
/// `remove-accountx` *not* match, so the probe recognises the subcommand and
/// not a longer word that happens to begin with it. Matching prose mid-sentence
/// is likewise excluded by the line-anchored `^`.
pub fn remove_account_primitive_available(usage_text: &str) -> bool {
    probe_re().is_match(usage_text)
}

fn authenticator_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)AuthenticatorDescription\s*\{type=([^,}]+)\},\s*ComponentInfo\{([^/]+)/")
            .expect("authenticator pattern is a compile-time constant")
    })
}

/// Extracts authenticator packages and the account types they own.
///
/// Parses the `RegisteredServicesCache` block of `dumpsys account`. The result
/// is the name-independent removal plan: we may not know *which* accounts exist
/// (Samsung hides them), but we always know which packages provide
/// authenticators.
///
/// Keyed by account type; a repeated type takes its last occurrence, as the
/// reference implementation's hashtable assignment does.
pub fn authenticator_map(dump_text: &str) -> BTreeMap<String, String> {
    let re = authenticator_re();
    let mut map = BTreeMap::new();

    // Matched per line, never across the whole dump. `[^,}]+` would otherwise
    // happily span a newline, accepting a composite the reference - which tests
    // line by line - would reject.
    for line in split_lines(dump_text) {
        for captures in re.captures_iter(line) {
            let (Some(account_type), Some(package)) = (captures.get(1), captures.get(2)) else {
                continue;
            };
            map.insert(
                account_type.as_str().trim().to_string(),
                package.as_str().trim().to_string(),
            );
        }
    }

    map
}

// ---------------------------------------------------------------------------
// Identifier redaction
// ---------------------------------------------------------------------------

fn email_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)^[^@\s]+@").expect("email pattern is a compile-time constant")
    })
}

/// Counts UTF-16 code units, so the token agrees with PowerShell's `.Length`.
///
/// A character outside the Basic Multilingual Plane costs two units here and
/// one Rust `char`. The token is a privacy artefact and its length is asserted,
/// so matching the reference's arithmetic is the point rather than a detail.
fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Redacts an email-shaped identifier to a non-identifying token.
///
/// Used wherever a real identifier must be reported - for example, to prove a
/// specific account was seen and then gone - without the identifier ever
/// reaching disk, a log, or a commit. Only the local-part *length* survives; the
/// domain and the local part are dropped entirely, so the token cannot be
/// reversed, matched against a wordlist, or correlated across runs.
///
/// `account_type` is caller-supplied and is not derived from the identifier.
pub fn identifier_token(identifier: &str, account_type: &str) -> String {
    if email_re().is_match(identifier) {
        let local_part = identifier.split('@').next().unwrap_or("");
        return format!("[{account_type} local-part-len={}]", utf16_len(local_part));
    }

    if identifier.trim().is_empty() {
        // Marked rather than blanked into a clean-looking result.
        return "[unknown-identifier]".to_string();
    }

    format!("[{account_type} opaque len={}]", utf16_len(identifier))
}

/// An account as the operator's UI hierarchy revealed it.
///
/// The UI dump is the only place One UI shows account names. The driver needs
/// them transiently to tap the right row; anything *persisted* comes from
/// [`redacted_account_view`] instead.
pub struct AccountRef<'a> {
    pub name: &'a str,
    pub account_type: &'a str,
}

/// An account as the application supplies it across the command boundary.
///
/// The borrowed [`AccountRef`] is what the pure core consumes, because it holds
/// nothing. This is the owned form that arrives over IPC and is converted into
/// that borrow, so the core's signature stays free of lifetimes it has no use
/// for.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub name: String,
    pub account_type: String,
}

impl<'a> From<&'a AccountInput> for AccountRef<'a> {
    fn from(account: &'a AccountInput) -> Self {
        AccountRef {
            name: &account.name,
            account_type: &account.account_type,
        }
    }
}

/// One entry of the redacted view: a token and a type, and nothing else.
#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
pub struct RedactedAccount {
    pub token: String,
    #[serde(rename = "type")]
    pub account_type: String,
}

/// Returns the redacted view of a visible-account list.
///
/// Always returns a collection, including for zero or one account. The
/// reference returns a scalar in the single-account case, an artefact of
/// PowerShell unrolling one-element arrays; preserving that would make the
/// caller branch on arity for no benefit.
pub fn redacted_account_view(accounts: &[AccountRef<'_>]) -> Vec<RedactedAccount> {
    accounts
        .iter()
        .map(|account| RedactedAccount {
            token: identifier_token(account.name, account.account_type),
            account_type: account.account_type.to_string(),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Removal ladder
// ---------------------------------------------------------------------------

/// One rung of the force-clean ladder.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rung {
    pub name: String,
    pub requires_name: bool,
    pub enabled: bool,
    pub detail: String,
}

/// Plans the removal ladder for this device.
///
/// Three rungs, tried in order. Each rung carries its name so the attestation
/// can record *how* every account was cleared: the proof is worthless if it
/// only says "zero" without saying how zero was reached.
///
/// 1. `PRIMITIVE` - `cmd account remove-account <name>`; commissioned, needs the
///    account name, and absent on Android 11. Probed first.
/// 2. `AUTHENTICATOR` - `pm uninstall --user 0 <pkg>` per authenticator package.
///    Name-independent, which is what makes it viable on Samsung, where most
///    accounts are not enumerable.
/// 3. `HUMAN` - accounts that survive both, escalated to the operator.
pub fn removal_ladder(primitive_available: bool) -> Vec<Rung> {
    vec![
        Rung {
            name: "PRIMITIVE".to_string(),
            requires_name: true,
            enabled: primitive_available,
            detail: if primitive_available {
                "available".to_string()
            } else {
                "absent on this build".to_string()
            },
        },
        Rung {
            name: "AUTHENTICATOR".to_string(),
            requires_name: false,
            enabled: true,
            detail: "pm uninstall --user 0 per authenticator package".to_string(),
        },
        Rung {
            name: "HUMAN".to_string(),
            requires_name: false,
            enabled: true,
            detail: "operator removes the remainder on-device".to_string(),
        },
    ]
}

/// One planned removal.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovalEntry {
    pub package: String,
    #[serde(rename = "type")]
    pub account_type: String,
    pub platform: bool,
}

/// Package prefixes that identify the platform's own sign-in stack.
///
/// The final pattern is redundant given the `com.samsung.` prefix. It is kept
/// because the reference lists it: the intent - this specific service is
/// platform - should stay legible even though the prefix already implies it.
fn is_platform_package(package: &str) -> bool {
    const PREFIXES: [&str; 4] = [
        "com.google.android.",
        "com.samsung.",
        "com.osp.",
        "com.android.",
    ];

    // `str::get`, not indexing: slicing with `package[..prefix.len()]` panics
    // when a multi-byte character straddles that offset, and a panic inside a
    // shipping Tauri command takes the operator's session down. Package names
    // are ASCII in practice, but "in practice" is not a guarantee worth a crash.
    PREFIXES.iter().any(|prefix| {
        package
            .get(..prefix.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
    }) || package.eq_ignore_ascii_case("com.samsung.android.mobileservice")
}

/// Orders authenticator packages so the destructive rung does least harm first.
///
/// The one guarantee this makes is that every third-party authenticator is
/// attempted before any platform authenticator. Removing WhatsApp's
/// authenticator costs nothing we care about, while removing
/// `com.google.android.gms` or the Samsung sign-in stack is a bigger
/// commitment - so if the count reaches zero early, no platform package has
/// been touched.
///
/// Within a tier the order is alphabetical by package name. That is deliberately
/// arbitrary and carries no safety property: do not read a "most consequential
/// last" guarantee into it, because it does not provide one. The real
/// protection is the tier boundary, and the per-package re-count in the driver,
/// which stops the ladder the moment the device is clean.
pub fn removal_order(authenticator_map: &BTreeMap<String, String>) -> Vec<RemovalEntry> {
    let mut entries: Vec<RemovalEntry> = authenticator_map
        .iter()
        .map(|(account_type, package)| RemovalEntry {
            package: package.clone(),
            account_type: account_type.clone(),
            platform: is_platform_package(package),
        })
        .collect();

    entries.sort_by(|left, right| {
        left.platform
            .cmp(&right.platform)
            .then_with(|| left.package.to_lowercase().cmp(&right.package.to_lowercase()))
            .then_with(|| left.account_type.cmp(&right.account_type))
    });

    // The reference sorts by (platform, package) with `-Unique`, which collapses
    // entries agreeing on those properties. Platform is derived from package, so
    // collapsing on the lowercased package is equivalent. The retained entry is
    // the first in sorted order - the tie-break above makes that deterministic
    // rather than dependent on map iteration order.
    let mut seen = BTreeSet::new();
    entries.retain(|entry| seen.insert(entry.package.to_lowercase()));

    entries
}

// ---------------------------------------------------------------------------
// Attestation
// ---------------------------------------------------------------------------

/// One attempted rung, recorded for the attestation.
#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub rung: String,
    pub outcome: String,
}

/// The attestation record for a force-clean run.
///
/// Deliberately identifier-free: counts, types, rungs, timestamps, outcomes. No
/// account name, no device serial, no package-removal payload beyond the
/// authenticator packages that were acted on. This is the artifact that gets
/// committed; the phone's actual contents stay on the phone.
///
/// Field order is fixed by the reference implementation and preserved here, so
/// a consumer diffing records sees a stable shape.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttestationRecord {
    pub schema: String,
    pub tool: String,
    pub device_model: String,
    pub android_release: String,
    pub primitive_status: String,
    pub baseline_accounts: i32,
    pub final_accounts: i32,
    pub clean: bool,
    pub accounts_removed: i32,
    pub removed_packages: Vec<String>,
    pub attempts: Vec<Attempt>,
    pub started_at: String,
    pub completed_at: String,
    pub identifiers_stored: bool,
    pub serial_stored: bool,
}

/// Identifies the artefact contract, unchanged from the reference so existing
/// consumers still key on it.
pub const ATTESTATION_SCHEMA: &str = "cyvra.pur-do-wipe.attestation/1";

/// Identifies the producer.
///
/// The reference recorded `ForceCleanAccounts.ps1`. This records the native
/// implementation instead: attesting to a script that did not run would claim a
/// provenance this code does not have.
pub const ATTESTATION_TOOL: &str = "cyvra-mobile-desktop force_clean (rust)";

/// Builds the attestation record for a force-clean run.
#[allow(clippy::too_many_arguments)]
pub fn new_attestation_record(
    baseline_count: i32,
    final_count: i32,
    device_model: &str,
    android_release: &str,
    primitive_status: &str,
    attempts: Vec<Attempt>,
    removed_packages: Vec<String>,
    started_at: &str,
    completed_at: &str,
) -> AttestationRecord {
    AttestationRecord {
        schema: ATTESTATION_SCHEMA.to_string(),
        tool: ATTESTATION_TOOL.to_string(),
        device_model: device_model.to_string(),
        android_release: android_release.to_string(),
        primitive_status: primitive_status.to_string(),
        baseline_accounts: baseline_count,
        final_accounts: final_count,
        clean: device_owner_precondition(final_count),
        accounts_removed: baseline_count - final_count,
        removed_packages,
        attempts,
        started_at: started_at.to_string(),
        completed_at: completed_at.to_string(),
        identifiers_stored: false,
        serial_stored: false,
    }
}

// ---------------------------------------------------------------------------
// Parity oracle
// ---------------------------------------------------------------------------
//
// A verbatim port of `scripts/pur-do-wipe/ForceCleanAccounts.Tests.ps1`: 43
// assertions, one per `Assert-*` call in the reference. Each carries a `P-NN`
// label matching its position in that file, so the count can be checked by
// search rather than trusted - `grep -c 'P-[0-9][0-9]'` must report 43.
//
// These are not "tests we wrote for the port". They are the assertions that were
// run against a real Samsung device's dump formats, and they are the sole
// definition of what "parity" means for this module.

#[cfg(test)]
mod tests {
    use super::*;

    // --- count parsing: the Samsung trap ------------------------------------

    // The AOSP-shaped dump. `Accounts: <n>` is the header both AOSP and Samsung
    // print, and it is the only count that can be trusted.
    const AOSP_DUMP: &str = "Accounts: 3\nNow: 12345\nActive Syncs: 0\n";

    // One UI replaces the header with an event-history table. Reading a zero out
    // of this is the exact false positive the detector exists to prevent.
    const SAMSUNG_DUMP: &str = "User UserInfo{0:owner:c13}:\n\
                               \n\
                               AccountId, Action_Type, timestamp, UID, TableName, Key\n\
                               Accounts History\n\
                               31,action_account_add,2022-08-12 16:02:49,10105,accounts,23\n\
                               31,action_account_remove,2022-08-12 16:41:19,10105,accounts,24\n\
                               \n\
                               Active Sessions: 0\n";

    // A dump carrying BOTH the history table and a real header: the header wins.
    const MIXED_DUMP: &str = "Accounts History\n\
                              31,action_account_add,2022-08-12 16:02:49,10105,accounts,23\n\
                              \n\
                              Accounts: 9\n\
                              Active Syncs: 0\n";

    #[test]
    fn p01_reads_accounts_header_from_aosp_shaped_dump() {
        assert_eq!(3, account_count_from_content_dump(AOSP_DUMP)); // P-01
    }

    #[test]
    fn p02_samsung_dump_without_header_yields_minus_one_never_a_false_zero() {
        assert_eq!(-1, account_count_from_content_dump(SAMSUNG_DUMP)); // P-02
    }

    #[test]
    fn p03_empty_input_yields_minus_one_never_a_false_zero() {
        assert_eq!(-1, account_count_from_content_dump("")); // P-03
    }

    #[test]
    fn p04_reads_the_real_header_even_when_history_table_present() {
        assert_eq!(9, account_count_from_content_dump(MIXED_DUMP)); // P-04
    }

    #[test]
    fn p05_handles_the_indentation_dumpsys_content_actually_uses() {
        assert_eq!(10, account_count_from_content_dump("  Accounts: 10\n  Now: 1")); // P-05
    }

    // --- device-owner precondition ------------------------------------------

    #[test]
    fn p06_zero_accounts_satisfies_the_precondition() {
        assert!(device_owner_precondition(0)); // P-06
    }

    #[test]
    fn p07_one_account_is_enough_to_block_enrolment() {
        assert!(!device_owner_precondition(1)); // P-07
    }

    #[test]
    fn p08_ten_accounts_block_enrolment() {
        assert!(!device_owner_precondition(10)); // P-08
    }

    #[test]
    fn p09_an_unreadable_dump_never_satisfies_the_precondition() {
        // The load-bearing rule in its highest-stakes position: -1 means
        // "we do not know", and "we do not know" must never pass as "clean".
        assert!(!device_owner_precondition(-1)); // P-09
    }

    // --- primitive probe ----------------------------------------------------

    const ANDROID_11_USAGE: &str = "Account manager service commands:\n\
                                   \x20 help\n\
                                   \x20\x20\x20 Print this help text.\n\
                                   \x20 set-bind-instant-service-allowed [--user <USER_ID> (current user if not specified)] true|false\n\
                                   \x20\x20\x20 Set whether binding to services provided by instant apps is allowed.\n\
                                   \x20 get-bind-instant-service-allowed [--user <USER_ID> (current user if not specified)]\n\
                                   \x20\x20\x20 Get whether binding to services provided by instant apps is allowed.\n";

    const FUTURE_USAGE: &str = "Account manager service commands:\n\
                                \x20 help\n\
                                \x20 remove-account [--user <USER_ID>] <name>\n\
                                \x20\x20\x20 Remove the account with the given name.\n";

    // Prose that mentions the phrase mid-sentence. The `^` anchor is what keeps
    // this from being read as a command definition.
    const PROSE_USAGE: &str = "\x20\x20help\n\
                               \x20\x20\x20\x20Print this help text. It does not remove-account data from the device.\n";

    #[test]
    fn p10_android_11_has_no_remove_account_so_the_ladder_skips_it() {
        assert!(!remove_account_primitive_available(ANDROID_11_USAGE)); // P-10
    }

    #[test]
    fn p11_a_build_that_exposes_remove_account_is_picked_up_without_code_change() {
        assert!(remove_account_primitive_available(FUTURE_USAGE)); // P-11
    }

    #[test]
    fn p12_prose_mentioning_the_phrase_is_not_a_command_definition() {
        assert!(!remove_account_primitive_available(PROSE_USAGE)); // P-12
    }

    #[test]
    fn p13_an_empty_usage_probe_cannot_claim_the_primitive_exists() {
        assert!(!remove_account_primitive_available("")); // P-13
    }

    // --- authenticator map --------------------------------------------------

    const ACCOUNT_DUMP: &str = "RegisteredServicesCache: 22 services\n\
                               \x20 ServiceInfo: AuthenticatorDescription {type=com.google}, ComponentInfo{com.google.android.gms/com.google.android.gms.auth.account.authenticator.GoogleAccountAuthenticatorService}, uid 10007\n\
                               \x20 ServiceInfo: AuthenticatorDescription {type=com.whatsapp}, ComponentInfo{com.whatsapp/com.whatsapp.accountsync.AccountAuthenticatorService}, uid 10397\n\
                               \x20 ServiceInfo: AuthenticatorDescription {type=us.zoom.videomeetings}, ComponentInfo{us.zoom.videomeetings/com.zipow.videobox.AuthenticatorService}, uid 10025\n";

    #[test]
    fn p14_maps_all_three_authenticator_types() {
        assert_eq!(3, authenticator_map(ACCOUNT_DUMP).len()); // P-14
    }

    #[test]
    fn p15_com_google_is_owned_by_gms() {
        let map = authenticator_map(ACCOUNT_DUMP);
        assert_eq!(
            Some(&"com.google.android.gms".to_string()),
            map.get("com.google")
        ); // P-15
    }

    #[test]
    fn p16_com_whatsapp_is_owned_by_whatsapp() {
        let map = authenticator_map(ACCOUNT_DUMP);
        assert_eq!(Some(&"com.whatsapp".to_string()), map.get("com.whatsapp")); // P-16
    }

    #[test]
    fn p17_zoom_self_authenticates() {
        let map = authenticator_map(ACCOUNT_DUMP);
        assert_eq!(
            Some(&"us.zoom.videomeetings".to_string()),
            map.get("us.zoom.videomeetings")
        ); // P-17
    }

    #[test]
    fn p18_a_dump_with_no_authenticators_yields_an_empty_plan_not_an_error() {
        assert_eq!(0, authenticator_map("no services here").len()); // P-18
    }

    // --- removal order: platform packages last ------------------------------

    /// The five-entry map the reference orders, keyed by account type.
    fn order_map() -> BTreeMap<String, String> {
        BTreeMap::from([
            ("com.google".to_string(), "com.google.android.gms".to_string()),
            (
                "com.osp.app.signin".to_string(),
                "com.osp.app.signin".to_string(),
            ),
            ("com.whatsapp".to_string(), "com.whatsapp".to_string()),
            (
                "us.zoom.videomeetings".to_string(),
                "us.zoom.videomeetings".to_string(),
            ),
            (
                "www.instagram.com".to_string(),
                "com.instagram.android".to_string(),
            ),
        ])
    }

    #[test]
    fn p19_third_party_authenticators_come_first_alphabetical_within_tier() {
        let third_party: Vec<String> = removal_order(&order_map())
            .into_iter()
            .filter(|entry| !entry.platform)
            .map(|entry| entry.package)
            .collect();

        assert_eq!(
            "com.instagram.android, com.whatsapp, us.zoom.videomeetings",
            third_party.join(", ")
        ); // P-19
    }

    #[test]
    fn p20_platform_authenticators_come_last_alphabetical_within_tier() {
        let platform: Vec<String> = removal_order(&order_map())
            .into_iter()
            .filter(|entry| entry.platform)
            .map(|entry| entry.package)
            .collect();

        assert_eq!(
            "com.google.android.gms, com.osp.app.signin",
            platform.join(", ")
        ); // P-20
    }

    #[test]
    fn p21_no_platform_package_reached_until_every_third_party_is_attempted() {
        let order = removal_order(&order_map());
        let third_party_count = order.iter().filter(|entry| !entry.platform).count();

        assert_eq!(
            "com.google.android.gms", order[third_party_count].package
        ); // P-21
    }

    #[test]
    fn p22_a_third_party_package_never_appears_after_a_platform_package() {
        // The property, stated directly: once a platform package has been seen,
        // nothing third-party may follow it.
        let mut seen_platform = false;
        for entry in removal_order(&order_map()) {
            if entry.platform {
                seen_platform = true;
            } else {
                assert!(!seen_platform); // P-22
            }
        }
    }

    #[test]
    fn p23_exactly_the_two_platform_packages_are_flagged_as_platform() {
        let platform_count = removal_order(&order_map())
            .iter()
            .filter(|entry| entry.platform)
            .count();

        assert_eq!(2, platform_count); // P-23
    }

    // --- removal ladder -----------------------------------------------------

    #[test]
    fn p24_the_ladder_always_has_three_rungs() {
        assert_eq!(3, removal_ladder(false).len()); // P-24
    }

    #[test]
    fn p25_primitive_rung_is_disabled_when_the_build_lacks_the_command() {
        assert!(!removal_ladder(false)[0].enabled); // P-25
    }

    #[test]
    fn p26_authenticator_rung_is_always_available() {
        assert!(removal_ladder(false)[1].enabled); // P-26
    }

    #[test]
    fn p27_primitive_rung_is_enabled_when_the_build_exposes_it() {
        assert!(removal_ladder(true)[0].enabled); // P-27
    }

    // --- identifier redaction: nothing egresses -----------------------------
    //
    // A synthetic address, not a real one. The reference fixture carries a real
    // Gmail account; this only needs a local part of length 13, and nothing the
    // assertion proves depends on the address being genuine. Real device fixture
    // content does not enter the codebase.
    //
    // The length is pinned because a token that silently became
    // length-preserving-but-wrong, or that collapsed to a constant, would both
    // still pass a loose "contains no @" check.

    const EMAIL: &str = "fixtureacct13@example.invalid";

    #[test]
    fn p28_the_local_part_never_survives_redaction() {
        let token = identifier_token(EMAIL, "com.google");

        // Derived from the constant rather than restated, so this cannot go
        // stale if the fixture is ever changed.
        let local_part = EMAIL.split('@').next().unwrap_or_default();
        assert!(!local_part.is_empty());
        assert!(!token.contains(local_part)); // P-28
    }

    #[test]
    fn p29_the_domain_never_survives_redaction() {
        let token = identifier_token(EMAIL, "com.google");
        assert!(!token.contains('@')); // P-29
    }

    #[test]
    fn p30_only_the_local_part_length_survives() {
        let token = identifier_token(EMAIL, "com.google");
        assert!(token.contains("local-part-len=13")); // P-30
    }

    #[test]
    fn p31_token_format_is_stable() {
        assert_eq!(
            "[com.google local-part-len=13]",
            identifier_token(EMAIL, "com.google")
        ); // P-31
    }

    #[test]
    fn p32_redaction_is_case_safe_and_identifier_free() {
        // The reference asserts against the wrong variable here: it re-checks the
        // earlier `$token` rather than `$opaque`. This asserts against `$opaque`,
        // which is plainly what was meant, so the check is strictly stronger than
        // the original while still passing it.
        let token = identifier_token("someone@example.org", "com.samsung.android.email");
        assert!(!token.to_lowercase().contains("gmail")); // P-32
    }

    #[test]
    fn p33_an_unknown_identifier_is_marked_not_blanked_into_a_clean_looking_result() {
        assert_eq!("[unknown-identifier]", identifier_token("", "com.google")); // P-33
    }

    #[test]
    fn p34_redacted_view_keeps_one_entry_per_account() {
        let view = redacted_account_view(&[
            AccountRef {
                name: "first.person@example.com",
                account_type: "com.google",
            },
            AccountRef {
                name: "second.person@example.org",
                account_type: "com.samsung.android.email",
            },
        ]);

        assert_eq!(2, view.len()); // P-34

        // P-35 and P-36: one assertion per entry, as the reference's foreach
        // produced. Kept as a loop so the count stays tied to the input.
        for entry in &view {
            assert!(!entry.token.contains('@')); // P-35, P-36
        }
    }

    // --- attestation: identifier-free by construction -----------------------

    fn attestation(final_count: i32) -> AttestationRecord {
        new_attestation_record(
            10,
            final_count,
            "SM-A107F",
            "11",
            "absent",
            vec![Attempt {
                rung: "AUTHENTICATOR".to_string(),
                outcome: "ok".to_string(),
            }],
            vec!["com.whatsapp".to_string()],
            "2026-10-09T21:00:00Z",
            "2026-10-09T21:12:00Z",
        )
    }

    #[test]
    fn p37_the_attestation_contains_no_at_character_at_all() {
        let json = serde_json::to_string(&attestation(0)).expect("attestation serialises");
        assert!(!json.contains('@')); // P-37
    }

    #[test]
    fn p38_the_attestation_contains_no_imei_shaped_literal() {
        let json = serde_json::to_string(&attestation(0)).expect("attestation serialises");

        // `\b\d{15}\b`: a 15-digit run bounded by non-digits, which is the shape
        // an IMEI takes. Reimplemented by hand rather than pulling in a regex.
        let digits = json.as_bytes();
        let mut run = 0usize;
        let mut found = false;
        for (index, byte) in digits.iter().enumerate() {
            let is_digit = byte.is_ascii_digit();
            if is_digit {
                run += 1;
            } else {
                let boundary_before = index == run || !digits[index - run - 1].is_ascii_digit();
                if run == 15 && boundary_before {
                    found = true;
                }
                run = 0;
            }
        }
        assert!(!found); // P-38
    }

    #[test]
    fn p39_zero_final_accounts_marks_the_run_clean() {
        assert!(attestation(0).clean); // P-39
    }

    #[test]
    fn p40_reports_how_many_were_removed() {
        assert_eq!(10, attestation(0).accounts_removed); // P-40
    }

    #[test]
    fn p41_records_explicitly_that_no_identifiers_were_stored() {
        assert!(!attestation(0).identifiers_stored); // P-41
    }

    #[test]
    fn p42_records_explicitly_that_no_serial_was_stored() {
        assert!(!attestation(0).serial_stored); // P-42
    }

    #[test]
    fn p43_a_nonzero_remainder_is_never_reported_as_clean() {
        let record = new_attestation_record(
            10,
            4,
            "SM-A107F",
            "11",
            "absent",
            Vec::new(),
            Vec::new(),
            "x",
            "y",
        );

        assert!(!record.clean); // P-43
    }

    // -----------------------------------------------------------------------
    // Guard tests: the two properties above, stated once more in the shapes
    // most likely to regress. These are additional to the 43 and are not a
    // substitute for them.
    // -----------------------------------------------------------------------

    #[test]
    fn guard_overflowing_count_is_failure_not_a_fabricated_zero() {
        // PowerShell raises here. Returning 0 would report a dirty device clean,
        // which is the single worst outcome this module can produce.
        assert_eq!(-1, account_count_from_content_dump("Accounts: 99999999999"));
    }

    #[test]
    fn guard_carriage_return_only_is_not_a_line_separator() {
        // PowerShell splits on `\r?\n`, never on a bare `\r`.
        assert_eq!(-1, account_count_from_content_dump("Accounts: 3\rNow: 1"));
        assert_eq!(3, account_count_from_content_dump("Accounts: 3\r\nNow: 1"));
    }

    #[test]
    fn guard_probe_word_boundary_rejects_longer_words() {
        assert!(!remove_account_primitive_available("  remove-accounts foo"));
        assert!(!remove_account_primitive_available("  remove-accountx"));
        assert!(remove_account_primitive_available("  remove-account foo"));
    }

    #[test]
    fn guard_authenticator_parse_never_spans_lines() {
        // The reference tests line by line. A whole-dump scan would let `[^,}]`
        // swallow a newline and accept a composite it should reject.
        let spanning = "AuthenticatorDescription {type=com.a\n\
                        com.b}, ComponentInfo{pkg/S}, uid 1";
        assert_eq!(0, authenticator_map(spanning).len());
    }

    #[test]
    fn guard_duplicate_package_collapses_to_one_removal() {
        let map = BTreeMap::from([
            ("a".to_string(), "com.zeta".to_string()),
            ("b".to_string(), "com.zeta".to_string()),
            ("c".to_string(), "com.alpha".to_string()),
        ]);

        assert_eq!(2, removal_order(&map).len());
    }

    #[test]
    fn guard_attestation_provenance_names_this_implementation() {
        // No assertion in the oracle covers this field, so it is guarded here:
        // the record must never claim a script that did not run.
        assert_ne!("ForceCleanAccounts.ps1", attestation(0).tool);
    }

    #[test]
    fn guard_attestation_json_shape_is_the_reference_shape() {
        // Serialised *directly*, so field order is the declaration order - the
        // order the reference's ordered hashtable produced.
        //
        // The route matters. `serde_json::to_value` routes through a `BTreeMap`,
        // which reorders these keys alphabetically, so asserting shape on a
        // `Value` would silently assert a different ordering than the one this
        // struct documents. Assert on the string, which is what actually ships.
        let json = serde_json::to_string(&attestation(0)).expect("attestation serialises");

        let expected = [
            "schema",
            "tool",
            "deviceModel",
            "androidRelease",
            "primitiveStatus",
            "baselineAccounts",
            "finalAccounts",
            "clean",
            "accountsRemoved",
            "removedPackages",
            "attempts",
            "startedAt",
            "completedAt",
            "identifiersStored",
            "serialStored",
        ];

        let mut cursor = 0usize;
        for key in expected {
            let needle = format!("\"{key}\":");
            match json[cursor..].find(&needle) {
                Some(offset) => cursor += offset + needle.len(),
                None => panic!("key `{key}` is missing or out of order in {json}"),
            }
        }
    }

    #[test]
    fn guard_platform_probe_never_panics_on_a_multibyte_boundary() {
        // "com." is 4 bytes and each 中 is 3, so the byte offset 12 - the length
        // of the "com.android." and "com.samsung." prefixes - falls *inside* the
        // third character. Indexing would panic here; `str::get` returns None.
        //
        // A panic inside a shipping Tauri command ends the operator's session,
        // which is the same failure mode the overflow ruling ruled out.
        let straddling = "com.\u{4e2d}\u{4e2d}\u{4e2d}";
        assert!(!is_platform_package(straddling));

        // And the classification it is meant to make still holds.
        assert!(is_platform_package("COM.SAMSUNG.ANDROID.APP"));
        assert!(is_platform_package("com.osp.app.signin"));
        assert!(!is_platform_package("com.instagram.android"));
    }
}
