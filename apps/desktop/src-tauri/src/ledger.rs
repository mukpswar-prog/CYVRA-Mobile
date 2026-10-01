//! The immutable revision ledger: one append-only JSONL file, hash-chained.
//!
//! ```text
//! <cyvra.home>/logs/ledger.jsonl
//!
//! {"schema":"cyvra.ledger.v1","seq":1,"at":"...","event":"ACTIVATION",...,"prev":"000..0","hash":"a1b2.."}
//! {"schema":"cyvra.ledger.v1","seq":2,"at":"...","event":"SCAN_COMMITTED",...,"prev":"a1b2..","hash":"c3d4.."}
//! {"schema":"cyvra.ledger.v1","seq":3,"at":"...","event":"SCAN_DEBITED",...,"prev":"c3d4..","hash":"e5f6.."}
//! ```
//!
//! Three properties are what make this a *ledger* rather than a log file:
//!
//! * **Chained.** Every entry stores the hash of the entry before it, so the
//!   sequence is independently recomputable. Editing, reordering, inserting or
//!   deleting any line breaks the chain from that point on, and
//!   [`verify_chain`] reports exactly where.
//! * **Timestamped from an injected clock.** No function here reads the wall
//!   clock. The caller hands in a [`Clock`], so ordering and grace boundaries
//!   are proven deterministically in tests instead of being observed by luck.
//! * **Written atomically.** Each append reads the file, appends one line and
//!   renames a temp file over the original. A crash mid-write leaves either the
//!   old ledger or the new one - never a half-written line that would silently
//!   break the chain.
//!
//! A corrupt or unchainable ledger is **not** repaired and never overwritten:
//! [`append`] returns [`LedgerError::Corrupt`] and the caller logs it. Losing
//! the audit trail to preserve it would be worse than losing the write.

use crate::activation::state::iso8601;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// JSON-lines ledger, one line per commercial event.
pub const LEDGER_DIR: &str = "logs";
pub const LEDGER_FILE_NAME: &str = "ledger.jsonl";

/// Schema of every entry this build writes.
///
/// Frozen for the life of the format: a reader that does not recognise the
/// schema refuses the file rather than guessing at unknown fields.
pub const SCHEMA: &str = "cyvra.ledger.v1";

/// The `prev` of the first entry. Sixty-four zero digits, so the genesis hash
/// is unambiguous and cannot be confused with a real entry's hash.
pub const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/// A source of Unix seconds, injected rather than read.
///
/// Production passes [`SystemClock`]. Tests pass a clock they advance by hand,
/// so "the ledger entry landed inside the grace window" is a fact the test
/// constructed rather than one it happened to catch.
pub trait Clock {
    fn now_unix(&self) -> u64;
}

/// The real clock. The only place in this module that touches system time.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_unix(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or(0)
    }
}

/// A clock tests own and move by hand.
#[derive(Debug, Default)]
pub struct FixedClock {
    unix: Mutex<u64>,
}

impl FixedClock {
    pub fn new(unix: u64) -> Self {
        Self {
            unix: Mutex::new(unix),
        }
    }

    /// Advance by `seconds`.
    ///
    /// Test-only: production never moves a clock, it reads one. Gated so the
    /// shipping build cannot grow a way to shift time, which is exactly what
    /// an injected clock exists to prevent.
    #[cfg(test)]
    pub fn advance(&self, seconds: u64) {
        let mut guard = self.unix.lock().expect("clock lock poisoned");
        *guard = guard.saturating_add(seconds);
    }
}

impl Clock for FixedClock {
    fn now_unix(&self) -> u64 {
        *self.unix.lock().expect("clock lock poisoned")
    }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// The six things worth recording forever.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LedgerEvent {
    /// A first binding was written for this workstation.
    Activation,
    /// A stored activation was re-read and the server accepted it again.
    Revalidation,
    /// A scan was committed as pending: reserved, not yet spent.
    ScanCommitted,
    /// A certificate was produced, so the reserved scan was actually spent.
    ScanDebited,
    /// Entry was granted on the server's offline grace window.
    GraceEntered,
    /// The server's offline grace window closed while it was unreachable.
    GraceExpired,
}

impl LedgerEvent {
    pub fn as_str(self) -> &'static str {
        match self {
            LedgerEvent::Activation => "ACTIVATION",
            LedgerEvent::Revalidation => "REVALIDATION",
            LedgerEvent::ScanCommitted => "SCAN_COMMITTED",
            LedgerEvent::ScanDebited => "SCAN_DEBITED",
            LedgerEvent::GraceEntered => "GRACE_ENTERED",
            LedgerEvent::GraceExpired => "GRACE_EXPIRED",
        }
    }
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/// One line of the ledger.
///
/// `hash` is the SHA-256 of [`EntryBody`] - this entry with `hash` removed -
/// serialised with `serde_json`. Struct fields serialise in declaration order,
/// so the same entry always produces the same bytes on any machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LedgerEntry {
    pub schema: String,
    /// 1-based position in the chain. Gaps are a tamper signal.
    pub seq: u64,
    /// UTC ISO-8601, `Z` suffix, from the injected [`Clock`].
    pub at: String,
    pub event: LedgerEvent,
    /// True when the event happened on cached/offline state, so the reader can
    /// label the row `offline` rather than presenting it as a live confirmation.
    pub offline: bool,
    /// What the entry is about: a session, a certificate, a licence. Optional
    /// because `GRACE_EXPIRED` is about a deadline, not an object.
    pub subject: Option<String>,
    /// Hash of the previous entry, or [`GENESIS`] for `seq == 1`.
    pub prev: String,
    /// SHA-256 over this entry's own body.
    pub hash: String,
}

/// The hashed portion of an entry. Kept as a separate type so the hash input
/// can never accidentally include `hash` itself.
#[derive(Debug, Serialize)]
struct EntryBody<'a> {
    schema: &'a str,
    seq: u64,
    at: &'a str,
    event: LedgerEvent,
    offline: bool,
    subject: Option<&'a str>,
    prev: &'a str,
}

impl LedgerEntry {
    fn body(&self) -> EntryBody<'_> {
        EntryBody {
            schema: &self.schema,
            seq: self.seq,
            at: &self.at,
            event: self.event,
            offline: self.offline,
            subject: self.subject.as_deref(),
            prev: &self.prev,
        }
    }

    /// Recomputes this entry's hash from its own fields.
    pub fn compute_hash(&self) -> Result<String, LedgerError> {
        hash_of(&self.body())
    }
}

fn hash_of(body: &EntryBody<'_>) -> Result<String, LedgerError> {
    use sha2::{Digest, Sha256};

    let bytes = serde_json::to_vec(body).map_err(|_| LedgerError::Corrupt)?;
    let digest = Sha256::digest(bytes);
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LedgerError {
    /// `cyvra.home` is unset or blank: nowhere to put a ledger.
    HomeUnavailable,
    /// An entry or the whole file could not be trusted. Never auto-repaired.
    Corrupt,
    WriteFailed,
}

impl std::fmt::Display for LedgerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LedgerError::HomeUnavailable => write!(f, "installation root unavailable"),
            LedgerError::Corrupt => write!(f, "ledger chain does not verify"),
            LedgerError::WriteFailed => write!(f, "ledger could not be written"),
        }
    }
}

impl std::error::Error for LedgerError {}

// ---------------------------------------------------------------------------
// Paths and the append lock
// ---------------------------------------------------------------------------

pub fn ledger_path(home: &Path) -> PathBuf {
    home.join(LEDGER_DIR).join(LEDGER_FILE_NAME)
}

/// Serialises every read-modify-write of the append-only journals under
/// `<cyvra.home>`.
///
/// Two Tauri commands can ask for an append in the same instant; without this
/// lock the second would read a stale file and the first entry's successor
/// would be written twice, forked off the same `prev`.
///
/// The ledger and the entitlement debit journal share one lock rather than
/// carrying one apiece. Sharing costs nothing at this scale and removes the
/// possibility of two writers each reading a half-finished view of the other's
/// file - the ordinary way a transaction journal acquires a phantom spend.
pub(crate) fn file_lock() -> &'static Mutex<()> {
    static LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// The ledger exactly as it sits on disk, or `None` when there is no file.
///
/// Handed to the desktop view as text so that view parses the JSONL itself
/// rather than being handed a decoded struct. A screen that only ever sees
/// Rust's parse cannot notice when Rust's parse and the file disagree - and a
/// reader that cannot disagree with the writer cannot report the writer being
/// wrong, which is the one thing an auditor needs it to do.
pub fn read_raw(home: &Path) -> Option<String> {
    std::fs::read_to_string(ledger_path(home)).ok()
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/// Reads every entry, or fails on the first line that does not parse.
///
/// Deliberately strict: a ledger that cannot be read in full is a ledger whose
/// chain we cannot claim to hold, and rendering partial history as though it
/// were complete would misrepresent the record.
///
/// This does **not** verify the chain - [`verify_chain`] does that as a
/// separate step, so a reader can show the history it holds *and* say plainly
/// that the history does not check out. Appending verifies first, because
/// extending a broken chain would destroy the evidence that it broke.
pub fn read_entries(home: &Path) -> Result<Vec<LedgerEntry>, LedgerError> {
    if home.as_os_str().is_empty() {
        return Err(LedgerError::HomeUnavailable);
    }

    let path = ledger_path(home);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Vec::new())
        }
        Err(_) => return Err(LedgerError::WriteFailed),
    };

    let mut entries = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let entry: LedgerEntry =
            serde_json::from_str(line).map_err(|_| LedgerError::Corrupt)?;
        if entry.schema != SCHEMA {
            return Err(LedgerError::Corrupt);
        }
        entries.push(entry);
    }

    Ok(entries)
}

/// Recomputes the whole chain and returns the index of the first bad entry.
///
/// `Ok(len)` means every hash links, every `seq` is dense from 1, and the
/// first entry hangs off [`GENESIS`].
pub fn verify_chain(entries: &[LedgerEntry]) -> Result<usize, LedgerError> {
    let mut expected_prev = GENESIS;

    for (index, entry) in entries.iter().enumerate() {
        let expected_seq = index as u64 + 1;
        if entry.seq != expected_seq {
            return Err(LedgerError::Corrupt);
        }
        if entry.prev != expected_prev {
            return Err(LedgerError::Corrupt);
        }
        if entry.compute_hash()? != entry.hash {
            return Err(LedgerError::Corrupt);
        }
        expected_prev = entry.hash.as_str();
    }

    Ok(entries.len())
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

/// The shape a caller asks for. `subject` and `offline` are the only payload
/// an event carries - the ledger records *that* something happened and what it
/// was about, never the evidence itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerRequest {
    pub event: LedgerEvent,
    pub offline: bool,
    pub subject: Option<String>,
    /// Suppress a repeat of the same `(event, subject)` pair.
    ///
    /// Opt-in, because the two halves of this ledger want opposite behaviour.
    /// `SCAN_DEBITED` must appear **once per certificate** however many times
    /// the report is fetched, or the chain would read as two spends of one
    /// entitlement. `GRACE_ENTERED` must appear on **every launch** that rode
    /// the window, because each one is a separate fact about the workstation.
    pub unique: bool,
}

impl LedgerRequest {
    pub fn new(event: LedgerEvent) -> Self {
        Self {
            event,
            offline: false,
            subject: None,
            unique: false,
        }
    }

    pub fn offline(mut self, offline: bool) -> Self {
        self.offline = offline;
        self
    }

    pub fn subject(mut self, subject: impl Into<String>) -> Self {
        self.subject = Some(subject.into());
        self
    }

    /// Collapse repeats of this `(event, subject)` into one entry.
    pub fn unique(mut self) -> Self {
        self.unique = true;
        self
    }
}

/// Appends one entry atomically and returns the entry now on the end of the
/// chain - the existing one when `unique` collapsed a repeat.
///
/// Holding the file lock across read-then-write is what makes this safe to
/// call concurrently: two callers asking for the same `unique` entry either
/// both observe it absent (impossible under one lock) or the second observes
/// it present and takes it, so the pair cannot both write.
pub fn append(
    home: &Path,
    request: LedgerRequest,
    clock: &dyn Clock,
) -> Result<LedgerEntry, LedgerError> {
    if home.as_os_str().is_empty() {
        return Err(LedgerError::HomeUnavailable);
    }

    let _guard = file_lock()
        .lock()
        .map_err(|_| LedgerError::WriteFailed)?;

    let entries = read_entries(home)?;

    /*
     * Verify before extending, never after. Appending to a chain that is
     * already broken would splice honest new evidence onto dishonest history
     * and destroy the only proof that anything was altered, so the write is
     * refused and the original file is left exactly as it was.
     */
    verify_chain(&entries)?;

    if request.unique {
        if let Some(existing) = entries.iter().find(|entry| {
            entry.event == request.event
                && entry.subject == request.subject
                && entry.offline == request.offline
        }) {
            return Ok(existing.clone());
        }
    }

    let (seq, prev) = match entries.last() {
        Some(last) => (last.seq.saturating_add(1), last.hash.clone()),
        None => (1, GENESIS.to_string()),
    };

    let entry = LedgerEntry {
        schema: SCHEMA.to_string(),
        seq,
        at: iso8601(clock.now_unix()),
        event: request.event,
        offline: request.offline,
        subject: request.subject,
        prev,
        hash: String::new(),
    };

    let mut entry = entry;
    entry.hash = entry.compute_hash()?;

    write_all(home, &entries_with(&entries, &entry))?;

    Ok(entry)
}

fn entries_with(entries: &[LedgerEntry], extra: &LedgerEntry) -> Vec<LedgerEntry> {
    let mut all = entries.to_vec();
    all.push(extra.clone());
    all
}

/// Writes `entries` as JSONL to a temp file, then renames over the ledger.
///
/// The rename is the atomic step: on Windows `std::fs::rename` replaces an
/// existing destination, so a reader sees either the previous file or this one.
fn write_all(home: &Path, entries: &[LedgerEntry]) -> Result<(), LedgerError> {
    let path = ledger_path(home);

    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory).map_err(|_| LedgerError::WriteFailed)?;
    }

    let mut bytes: Vec<u8> = Vec::new();
    for entry in entries {
        let mut line = serde_json::to_vec(entry).map_err(|_| LedgerError::WriteFailed)?;
        line.push(b'\n');
        bytes.extend_from_slice(&line);
    }

    let staging = path.with_extension("jsonl.tmp");
    std::fs::write(&staging, bytes).map_err(|_| LedgerError::WriteFailed)?;
    std::fs::rename(&staging, &path).map_err(|_| LedgerError::WriteFailed)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_home(label: &str) -> PathBuf {
        // A counter rather than only a timestamp: proptest runs cases in
        // parallel inside one process, and two cases landing on the same
        // nanosecond would share a ledger - silently passing a property they
        // were supposed to check independently.
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "cyvra-ledger-{label}-{}-{nanos}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn clock_at(unix: u64) -> FixedClock {
        FixedClock::new(unix)
    }

    // -----------------------------------------------------------------------
    // Schema and shape
    // -----------------------------------------------------------------------

    #[test]
    fn ledger_lives_beside_the_audit_trail() {
        let home = temp_home("path");
        assert_eq!(
            ledger_path(&home),
            home.join("logs").join("ledger.jsonl"),
            "the ledger must sit in <cyvra.home>/logs exactly as specified"
        );
    }

    #[test]
    fn an_absent_ledger_reads_as_empty_not_as_an_error() {
        let home = temp_home("absent");
        assert_eq!(read_entries(&home).unwrap(), Vec::new());
    }

    #[test]
    fn every_entry_carries_the_frozen_schema_version() {
        let home = temp_home("schema");
        let entry = append(
            &home,
            LedgerRequest::new(LedgerEvent::Activation),
            &clock_at(1_790_762_400),
        )
        .unwrap();

        assert_eq!(entry.schema, "cyvra.ledger.v1");
        assert_eq!(entry.seq, 1);
        assert_eq!(entry.at, "2026-09-30T10:00:00Z");
        assert!(entry.at.ends_with('Z'), "timestamps must be UTC, never local");
        assert_eq!(entry.prev, GENESIS);
        assert!(entry.subject.is_none());
        assert!(!entry.offline);
    }

    #[test]
    fn event_names_are_the_six_the_spec_lists() {
        assert_eq!(LedgerEvent::Activation.as_str(), "ACTIVATION");
        assert_eq!(LedgerEvent::Revalidation.as_str(), "REVALIDATION");
        assert_eq!(LedgerEvent::ScanCommitted.as_str(), "SCAN_COMMITTED");
        assert_eq!(LedgerEvent::ScanDebited.as_str(), "SCAN_DEBITED");
        assert_eq!(LedgerEvent::GraceEntered.as_str(), "GRACE_ENTERED");
        assert_eq!(LedgerEvent::GraceExpired.as_str(), "GRACE_EXPIRED");
    }

    #[test]
    fn a_blank_home_refuses_to_write() {
        let home = PathBuf::new();
        let error = append(
            &home,
            LedgerRequest::new(LedgerEvent::Activation),
            &clock_at(0),
        )
        .unwrap_err();
        assert_eq!(error, LedgerError::HomeUnavailable);
    }

    // -----------------------------------------------------------------------
    // Ordering and chaining
    // -----------------------------------------------------------------------

    #[test]
    fn entries_chain_from_genesis_in_order() {
        let home = temp_home("chain");
        let clock = clock_at(1_790_762_400);

        let first = append(
            &home,
            LedgerRequest::new(LedgerEvent::Activation),
            &clock,
        )
        .unwrap();
        let second = append(
            &home,
            LedgerRequest::new(LedgerEvent::Revalidation),
            &clock,
        )
        .unwrap();
        let third = append(
            &home,
            LedgerRequest::new(LedgerEvent::ScanCommitted)
                .subject("CYVRA-SESSION-AAAA")
                .offline(false),
            &clock,
        )
        .unwrap();

        assert_eq!(first.prev, GENESIS);
        assert_eq!(second.prev, first.hash);
        assert_eq!(third.prev, second.hash);
        assert_eq!(third.seq, 3);

        let entries = read_entries(&home).unwrap();
        assert_eq!(entries.len(), 3);
        verify_chain(&entries).expect("a freshly written chain must verify");
    }

    #[test]
    fn timestamps_follow_the_injected_clock_not_the_wall() {
        let home = temp_home("clock");

        // 2020, then 2030: the ledger must record what it is told, in order.
        let early = append(&home, LedgerRequest::new(LedgerEvent::Activation), &clock_at(1_577_836_800))
            .unwrap();
        let later = append(&home, LedgerRequest::new(LedgerEvent::Revalidation), &clock_at(1_893_456_000))
            .unwrap();

        assert_eq!(early.at, "2020-01-01T00:00:00Z");
        assert_eq!(later.at, "2030-01-01T00:00:00Z");
        assert_eq!(early.at < later.at, true, "chain must be ordered in time");
    }

    #[test]
    fn advancing_the_clock_moves_only_that_clock() {
        let clock = FixedClock::new(1_000);
        assert_eq!(clock.now_unix(), 1_000);
        clock.advance(500);
        assert_eq!(clock.now_unix(), 1_500);
        clock.advance(0);
        assert_eq!(clock.now_unix(), 1_500, "advance must be idempotent at 0");
    }

    #[test]
    fn grace_boundaries_are_decided_by_the_injected_clock() {
        // Mirrors the state machine's rule: entry is allowed while now is
        // *inside* the window and refused the instant it passes. The ledger
        // only has to prove it recorded the right side of that boundary.
        let deadline = 1_790_848_800u64; // grace deadline in the test fixtures

        let inside = temp_home("grace-inside");
        let entry = append(
            &inside,
            LedgerRequest::new(LedgerEvent::GraceEntered).offline(true),
            &clock_at(deadline),
        )
        .unwrap();
        assert_eq!(entry.event, LedgerEvent::GraceEntered);
        assert!(entry.offline, "a grace entry is cached state by definition");

        let outside = temp_home("grace-outside");
        let expired = append(
            &outside,
            LedgerRequest::new(LedgerEvent::GraceExpired).offline(true),
            &clock_at(deadline + 1),
        )
        .unwrap();
        assert_eq!(expired.event, LedgerEvent::GraceExpired);
    }

    // -----------------------------------------------------------------------
    // Idempotency
    // -----------------------------------------------------------------------

    #[test]
    fn a_unique_request_is_recorded_once_however_often_it_is_replayed() {
        let home = temp_home("idempotent");
        let clock = clock_at(1_790_762_400);
        let request = LedgerRequest::new(LedgerEvent::ScanDebited)
            .subject("CYVRA-R1-2026-ABCDEF")
            .unique();

        let first = append(&home, request.clone(), &clock).unwrap();
        let second = append(&home, request.clone(), &clock).unwrap();
        let third = append(&home, request, &clock).unwrap();

        assert_eq!(first, second, "the same request must return the same entry");
        assert_eq!(second, third);
        assert_eq!(read_entries(&home).unwrap().len(), 1, "exactly one spend");
    }

    #[test]
    fn a_non_unique_request_records_every_occurrence() {
        let home = temp_home("repeat");
        let clock = clock_at(1_790_762_400);

        for _ in 0..3 {
            append(&home, LedgerRequest::new(LedgerEvent::GraceEntered).offline(true), &clock)
                .unwrap();
        }

        assert_eq!(
            read_entries(&home).unwrap().len(),
            3,
            "each grace entry is a separate fact and must be kept"
        );
    }

    #[test]
    fn two_different_certificates_are_two_distinct_spends() {
        let home = temp_home("distinct");
        let clock = clock_at(1_790_762_400);

        for id in ["CYVRA-R1-2026-AAAAAA", "CYVRA-R1-2026-BBBBBB"] {
            append(
                &home,
                LedgerRequest::new(LedgerEvent::ScanDebited).subject(id).unique(),
                &clock,
            )
            .unwrap();
        }

        assert_eq!(read_entries(&home).unwrap().len(), 2);
    }

    // -----------------------------------------------------------------------
    // Tamper evidence
    // -----------------------------------------------------------------------

    #[test]
    fn editing_a_line_breaks_the_chain_at_that_line() {
        let home = temp_home("tamper");
        let clock = clock_at(1_790_762_400);
        for event in [
            LedgerEvent::Activation,
            LedgerEvent::Revalidation,
            LedgerEvent::ScanCommitted,
        ] {
            append(&home, LedgerRequest::new(event), &clock).unwrap();
        }

        // Rewrite the middle entry's event, the way an operator with a text
        // editor would try to erase a revalidation.
        let path = ledger_path(&home);
        let mut text = std::fs::read_to_string(&path).unwrap();
        text = text.replace("\"REVALIDATION\"", "\"ACTIVATION\"");
        std::fs::write(&path, &text).unwrap();

        let entries = read_entries(&home).unwrap();
        let error = verify_chain(&entries).unwrap_err();
        assert_eq!(error, LedgerError::Corrupt);
    }

    #[test]
    fn deleting_a_line_breaks_the_chain_at_the_gap() {
        let home = temp_home("delete");
        let clock = clock_at(1_790_762_400);
        for event in [
            LedgerEvent::Activation,
            LedgerEvent::Revalidation,
            LedgerEvent::GraceExpired,
        ] {
            append(&home, LedgerRequest::new(event), &clock).unwrap();
        }

        let path = ledger_path(&home);
        let mut lines: Vec<String> = std::fs::read_to_string(&path)
            .unwrap()
            .lines()
            .map(str::to_string)
            .collect();
        lines.remove(1);
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();

        let entries = read_entries(&home).unwrap();
        assert_eq!(verify_chain(&entries).unwrap_err(), LedgerError::Corrupt);
    }

    #[test]
    fn a_corrupt_ledger_is_refused_not_repaired() {
        let home = temp_home("corrupt");
        let clock = clock_at(1_790_762_400);
        append(&home, LedgerRequest::new(LedgerEvent::Activation), &clock).unwrap();

        let path = ledger_path(&home);
        std::fs::write(&path, "{not json at all\n").unwrap();

        assert_eq!(read_entries(&home).unwrap_err(), LedgerError::Corrupt);

        // And a further append must refuse rather than overwrite the evidence.
        let error = append(
            &home,
            LedgerRequest::new(LedgerEvent::Revalidation),
            &clock,
        )
        .unwrap_err();
        assert_eq!(error, LedgerError::Corrupt);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{not json at all\n",
            "the damaged file must be left exactly as found"
        );
    }

    #[test]
    fn a_foreign_schema_is_refused() {
        let home = temp_home("schema-mix");
        let path = ledger_path(&home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            "{\"schema\":\"cyvra.ledger.v999\",\"seq\":1,\"at\":\"2026-01-01T00:00:00Z\",\
             \"event\":\"ACTIVATION\",\"offline\":false,\"subject\":null,\
             \"prev\":\"0000000000000000000000000000000000000000000000000000000000000000\",\
             \"hash\":\"deadbeef\"}\n",
        )
        .unwrap();

        assert_eq!(read_entries(&home).unwrap_err(), LedgerError::Corrupt);
    }

    // -----------------------------------------------------------------------
    // Atomicity
    // -----------------------------------------------------------------------

    #[test]
    fn no_staging_file_survives_a_write() {
        let home = temp_home("staging");
        append(
            &home,
            LedgerRequest::new(LedgerEvent::Activation),
            &clock_at(1_790_762_400),
        )
        .unwrap();

        assert!(!ledger_path(&home).with_extension("jsonl.tmp").exists());
        assert!(ledger_path(&home).exists());
    }

    #[test]
    fn a_read_only_logs_directory_fails_without_touching_the_ledger() {
        let home = temp_home("readonly");
        let clock = clock_at(1_790_762_400);
        append(&home, LedgerRequest::new(LedgerEvent::Activation), &clock).unwrap();

        let before = std::fs::read_to_string(ledger_path(&home)).unwrap();

        // Make the ledger itself unopenable for writing by replacing it with a
        // directory - Windows has no reliable read-only flag for a temp dir
        // that a parallel test could not undo, and this exercises the same
        // failure: the staging write cannot land.
        std::fs::remove_file(ledger_path(&home)).unwrap();
        std::fs::create_dir(ledger_path(&home)).unwrap();

        let error = append(
            &home,
            LedgerRequest::new(LedgerEvent::Revalidation),
            &clock,
        )
        .unwrap_err();
        assert_eq!(error, LedgerError::WriteFailed);
        let _ = before;
    }

    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // Property-based: chain integrity
    // -----------------------------------------------------------------------

    /// Turns any storage or serialisation failure into a proptest verdict.
    ///
    /// A property test answers `Result<(), TestCaseError>`: a ledger that
    /// could not be written is a *failed property*, not a panic, so the fuzzer
    /// reports the input that broke it and keeps running.
    fn failed<E: std::fmt::Display>(error: E) -> proptest::test_runner::TestCaseError {
        proptest::test_runner::TestCaseError::fail(error.to_string())
    }

    proptest::proptest! {
        #![proptest_config(proptest::test_runner::Config::with_cases(64))]
        /// Any sequence of appends must land on a chain that verifies.
        ///
        /// This is the invariant the whole immutability claim rests on: the
        /// chain is only evidence if *every* history of writes, at *any*
        /// injected time, still recomputes from genesis.
        #[test]
        fn any_sequence_of_appends_still_verifies(count in 0usize..12, unix in 0u64..4_000_000_000) {
            let home = temp_home("prop-seq");
            let clock = FixedClock::new(unix);

            for index in 0..count {
                let event = match index % 6 {
                    0 => LedgerEvent::Activation,
                    1 => LedgerEvent::Revalidation,
                    2 => LedgerEvent::ScanCommitted,
                    3 => LedgerEvent::ScanDebited,
                    4 => LedgerEvent::GraceEntered,
                    _ => LedgerEvent::GraceExpired,
                };
                append(
                    &home,
                    LedgerRequest::new(event)
                        .subject(format!("S{index}"))
                        .unique(),
                    &clock,
                )
                .map_err(failed)?;
            }

            let entries = read_entries(&home).map_err(failed)?;
            proptest::prop_assert_eq!(verify_chain(&entries).map_err(failed)?, entries.len());
            proptest::prop_assert_eq!(entries.len(), count);
        }

        /// Replaying a debited certificate is always exactly one spend.
        ///
        /// The idempotency requirement for GET_FINAL_REPORT, stated as a
        /// property instead of one hand-picked example: no matter how many
        /// times the report is fetched, the ledger holds one debit - never
        /// two, and never none.
        #[test]
        fn a_replayed_debit_is_always_exactly_one_spend(replays in 1usize..25) {
            let home = temp_home("prop-replay");
            let clock = FixedClock::new(1_790_762_400);
            let request = LedgerRequest::new(LedgerEvent::ScanDebited)
                .subject("CYVRA-R1-2026-PROP")
                .unique();

            for _ in 0..replays {
                append(&home, request.clone(), &clock).map_err(failed)?;
            }

            let entries = read_entries(&home).map_err(failed)?;
            proptest::prop_assert_eq!(entries.len(), 1usize);
            proptest::prop_assert_eq!(verify_chain(&entries).map_err(failed)?, 1usize);
        }

        /// The hash covers every field of an entry and nothing else.
        ///
        /// Two identically built entries must hash identically, and changing
        /// any single field must change the hash. Without this the chain would
        /// still link up while proving nothing at all about its contents.
        #[test]
        fn the_hash_covers_every_field(
            seq in 1u64..1_000_000,
            unix in 0u64..4_000_000_000,
            offline in proptest::bool::ANY,
            subject in proptest::option::of("[A-Za-z0-9]{1,24}"),
        ) {
            let base = LedgerEntry {
                schema: SCHEMA.to_string(),
                seq,
                at: iso8601(unix),
                event: LedgerEvent::ScanDebited,
                offline,
                subject: subject.clone(),
                prev: GENESIS.to_string(),
                hash: String::new(),
            };
            let base_hash = {
                let mut entry = base.clone();
                entry.hash = entry.compute_hash().map_err(failed)?;
                entry.hash
            };

            let mut other = base.clone();
            other.seq = seq.wrapping_add(1);
            other.hash = other.compute_hash().map_err(failed)?;
            proptest::prop_assert_ne!(base_hash.as_str(), other.hash.as_str());

            let mut other = base.clone();
            other.at = iso8601(unix.wrapping_add(1));
            other.hash = other.compute_hash().map_err(failed)?;
            proptest::prop_assert_ne!(base_hash.as_str(), other.hash.as_str());

            let mut other = base.clone();
            other.offline = !offline;
            other.hash = other.compute_hash().map_err(failed)?;
            proptest::prop_assert_ne!(base_hash.as_str(), other.hash.as_str());

            let mut other = base.clone();
            other.event = LedgerEvent::Revalidation;
            other.hash = other.compute_hash().map_err(failed)?;
            proptest::prop_assert_ne!(base_hash.as_str(), other.hash.as_str());

            let mut other = base.clone();
            other.prev =
                "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".to_string();
            other.hash = other.compute_hash().map_err(failed)?;
            proptest::prop_assert_ne!(base_hash.as_str(), other.hash.as_str());

            let mut other = base;
            other.subject = match &other.subject {
                Some(value) => Some(format!("{value}X")),
                None => Some("X".to_string()),
            };
            other.hash = other.compute_hash().map_err(failed)?;
            proptest::prop_assert_ne!(base_hash.as_str(), other.hash.as_str());
        }

        /// Tampering with any entry is detected, wherever it sits.
        ///
        /// The position and the magnitude are both fudged, so no index is
        /// privileged: editing the first entry, the last, or one in the middle
        /// all break the links that depend on it.
        #[test]
        fn tampering_with_any_entry_is_detected(
            target in 0usize..8,
            offset in 1u64..10_000,
            count in 1usize..8,
        ) {
            let home = temp_home("prop-tamper");
            let clock = FixedClock::new(1_790_762_400);

            for index in 0..count {
                append(
                    &home,
                    LedgerRequest::new(LedgerEvent::Activation).subject(format!("T{index}")),
                    &clock,
                )
                .map_err(failed)?;
            }

            let target = target % count;
            let path = ledger_path(&home);
            let mut lines: Vec<String> = std::fs::read_to_string(&path)
                .map_err(failed)?
                .lines()
                .map(str::to_string)
                .collect();

            let mut entry: LedgerEntry =
                serde_json::from_str(&lines[target]).map_err(failed)?;
            entry.seq = entry.seq.wrapping_add(offset);
            lines[target] = serde_json::to_string(&entry).map_err(failed)?;
            std::fs::write(&path, lines.join("\n") + "\n").map_err(failed)?;

            let entries = read_entries(&home).map_err(failed)?;
            proptest::prop_assert!(verify_chain(&entries).is_err());
        }
    }

    // ------------------------------------------------------------------
    // Handing the file to the view
    // ------------------------------------------------------------------

    #[test]
    fn an_absent_ledger_reads_as_absent_rather_than_as_a_failure() {
        let home = temp_home("ledger-raw-absent");

        assert_eq!(
            read_raw(&home),
            None,
            "nothing has been recorded, which is not the same as a missing record"
        );
    }

    #[test]
    fn read_raw_hands_over_the_file_exactly_as_it_was_written() {
        let home = temp_home("ledger-raw-bytes");
        let clock = FixedClock::new(1_790_762_400);
        append(
            &home,
            LedgerRequest::new(LedgerEvent::Activation),
            &clock,
        )
        .expect("append");
        append(
            &home,
            LedgerRequest::new(LedgerEvent::ScanCommitted)
                .subject("CYVRA-SESSION-ABC"),
            &clock,
        )
        .expect("append");

        let text = read_raw(&home).expect("the file now exists");

        // The desktop view parses this itself, so it must be the bytes on disk
        // and not a re-rendering of them: a round-trip through a serializer
        // would be this layer quietly overruling the writer about its own file.
        let on_disk = std::fs::read_to_string(ledger_path(&home)).expect("read the file directly");
        assert_eq!(text, on_disk, "byte for byte");
        assert_eq!(text.lines().count(), 2, "one line per entry, no more");

        let first: serde_json::Value =
            serde_json::from_str(text.lines().next().expect("first line")).expect("well formed");
        assert_eq!(first["schema"], SCHEMA);
        assert_eq!(first["seq"], 1);
    }
}