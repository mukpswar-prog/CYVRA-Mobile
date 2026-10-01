use std::{collections::HashMap, sync::Mutex};

use serde::Serialize;

use crate::activation::{entitlement, state, store};
use crate::host_process::{self, HostInfo, HostProcessManager};
use crate::ledger::{self, Clock};

#[cfg(windows)]
use crate::usb::{enumerate::enumerate_usb_devices, model::UsbObservationState};

#[cfg(windows)]
use crate::wpd::discovery::{enumerate_devices, WpdDeviceDescriptor};

pub struct HostState {
    pub manager: Mutex<HostProcessManager>,
    wpd_session_ids: Mutex<WpdSessionIds>,
}

impl HostState {
    pub fn new() -> Self {
        Self {
            manager: Mutex::new(HostProcessManager::new()),
            wpd_session_ids: Mutex::new(WpdSessionIds::default()),
        }
    }
}

#[derive(Default)]
struct WpdSessionIds {
    by_pnp_device_id: HashMap<String, String>,
    next_id: u64,
}

impl WpdSessionIds {
    fn id_for(&mut self, pnp_device_id: &str) -> Result<String, String> {
        let key = pnp_device_id.to_ascii_lowercase();

        if let Some(existing) = self.by_pnp_device_id.get(&key) {
            return Ok(existing.clone());
        }

        self.next_id = self
            .next_id
            .checked_add(1)
            .ok_or_else(|| "WPD_SESSION_ID_EXHAUSTED".to_string())?;

        // Presentation correlation only. This is not an authorization token
        // and intentionally contains no native Windows PnP identifier.
        let session_device_id = format!("wpd-session-{:08}", self.next_id);

        self.by_pnp_device_id.insert(key, session_device_id.clone());

        Ok(session_device_id)
    }
}

#[cfg(test)]
mod tests {
    use super::WpdSessionIds;

    #[test]
    fn same_wpd_device_reuses_session_id_case_insensitively() {
        let mut ids = WpdSessionIds::default();

        let first = ids
            .id_for(r"USB\VID_04E8&PID_6860\ABC123")
            .expect("first session id");

        let second = ids
            .id_for(r"usb\vid_04e8&pid_6860\abc123")
            .expect("second session id");

        assert_eq!(first, second);
    }

    #[test]
    fn different_wpd_devices_receive_distinct_session_ids() {
        let mut ids = WpdSessionIds::default();

        let first = ids
            .id_for(r"USB\VID_04E8&PID_6860\ABC123")
            .expect("first session id");

        let second = ids
            .id_for(r"USB\VID_04E8&PID_6860\XYZ789")
            .expect("second session id");

        assert_ne!(first, second);
    }

    #[test]
    fn session_id_does_not_expose_native_pnp_id() {
        let mut ids = WpdSessionIds::default();
        let native_id = r"USB\VID_04E8&PID_6860\PRIVATE_DEVICE_ID";

        let session_id = ids.id_for(native_id).expect("session id");

        assert!(!session_id.contains(native_id));
        assert!(!session_id.contains("VID_04E8"));
        assert!(session_id.starts_with("wpd-session-"));
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfoResult {
    pub connected: bool,
    pub protocol_version: String,
    pub request_id: String,
    pub host_version: String,
}

/// Rust Windows USB plane summary (FSB-003 authority).
///
/// Raw PnP device-instance identities intentionally stay internal
/// (canonical guideline P0: raw PnP ID exposure).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsbObservationSummary {
    pub observation_state: String,
    pub device_count: usize,
    pub observed_at: String,
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStateResult {
    pub connection_state: String,
    pub usb_state: String,
    pub adb_state: String,
    pub adb_available: bool,
    pub ready_to_scan: bool,
    pub status_message: String,
    pub operator_action_required: Option<String>,
    pub device_descriptor: Option<serde_json::Value>,
    pub usb_observation: UsbObservationSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WpdDeviceResult {
    pub session_device_id: String,
    pub friendly_name: Option<String>,
    pub manufacturer: Option<String>,
    pub description: Option<String>,
}

#[cfg(windows)]
impl WpdDeviceResult {
    fn from_descriptor(value: WpdDeviceDescriptor, session_device_id: String) -> Self {
        Self {
            session_device_id,
            friendly_name: value.friendly_name,
            manufacturer: value.manufacturer,
            description: value.description,
        }
    }
}

#[tauri::command]
pub async fn get_host_info(state: tauri::State<'_, HostState>) -> Result<HostInfoResult, String> {
    let mut manager = state
        .manager
        .lock()
        .map_err(|_| "HOST_STATE_LOCK_FAILED".to_string())?;

    let HostInfo {
        protocol_version,
        request_id,
        host_version,
    } = manager.get_host_info()?;

    Ok(HostInfoResult {
        connected: true,
        protocol_version,
        request_id,
        host_version,
    })
}

/// Generic JSON-lines pass-through to the Kotlin Host.
///
/// `command` is a `HostCommand` name and `payload` a JSON object string; both
/// are handed to [`HostProcessManager::send_host_command`], which stamps the
/// `protocolVersion` / `requestId` envelope, writes one line to the Host's stdin
/// and reads the single line it answers with on stdout.
///
/// The response is returned **verbatim, including a `status: "ERROR"` envelope**.
/// `LICENSE_REQUIRED`, `SANITIZE_PHRASE_MISMATCH` and the decision D-1
/// `BLOCKED_NOT_IMPLEMENTED` outcome are protocol answers the UI must render
/// accurately, not exceptions. `Err` is reserved for the bridge itself failing,
/// which is a genuinely different class of problem:
///
/// * `Ok(response)` - the Host answered, whatever its status.
/// * `Err(message)` - the Host could not be reached or its envelope was invalid.
#[tauri::command]
pub async fn send_host_command(
    state: tauri::State<'_, HostState>,
    command: String,
    payload: String,
) -> Result<String, String> {
    /*
     * The lock is held across the whole write-then-read exchange on purpose:
     * the Host speaks JSON-lines over a single stdin/stdout pair, so two
     * concurrent requests would interleave their bytes and each read the
     * other's answer. Serialising here is what makes the wire protocol true.
     */
    let line = {
        let mut manager = state
            .manager
            .lock()
            .map_err(|_| "HOST_STATE_LOCK_FAILED".to_string())?;

        manager.send_host_command(&command, &payload)?
    };

    /*
     * Scan transactions are recorded on this side of the wire rather than by
     * the Host, because this is the only place that sees both halves: the
     * command asked for and the answer actually given. The Host stays a pure
     * protocol engine and the ledger keeps exactly one writer.
     *
     * It runs after the host lock is released - the ledger takes its own file
     * lock, and holding two locks across a disk write in acquisition order is
     * how an accidental lock order gets baked in.
     */
    let recorded = {
        let command = command.clone();
        let line = line.clone();
        tauri::async_runtime::spawn_blocking(move || record_scan_ledger(&command, &line)).await
    };

    match recorded {
        Ok(Ok(())) => {}
        Ok(Err(error)) => log::warn!("scan ledger entry not written: {error}"),
        Err(error) => log::warn!("scan ledger task failed: {error}"),
    }

    Ok(line)
}

/// Whether the Host is running on the restricted offline lease right now.
///
/// Answered by comparing the snapshot the Host was actually handed in
/// `entitlement.json` against the offline lease the server signed at
/// activation. That file is the only source that can settle the question
/// without guessing, because it is the very document the Host reads to decide
/// what it is allowed to do.
///
/// `false` when the comparison cannot be made. Reaching that would mean there
/// is no activation store or no entitlement file - and no scan could have been
/// performed in that condition - so this is a fallback for a fault rather than
/// a second answer. It is written here so the provenance label on a scan row
/// cannot drift from the licence state that scan was performed under.
fn on_offline_lease(home: &std::path::Path) -> bool {
    store::read(home)
        .ok()
        .flatten()
        .and_then(|stored| entitlement::on_offline_lease(home, &stored.offline_lease.signature))
        .unwrap_or(false)
}

/// Appends the ledger entry a scan exchange implies, if it implies one.
///
/// Only two commands ever move an entitlement, and only a `status: "OK"`
/// answer means the Host actually did the work: a refused or failed
/// `RUN_SCAN` reserves nothing, and a `GET_FINAL_REPORT` that did not produce
/// a certificate spends nothing. Recording from the status rather than from
/// the request is what keeps the ledger from claiming spends that never
/// happened.
fn record_scan_ledger(command: &str, line: &str) -> Result<(), ledger::LedgerError> {
    let request = match command {
        "RUN_SCAN" => ledger::LedgerRequest::new(ledger::LedgerEvent::ScanCommitted),
        "GET_FINAL_REPORT" => ledger::LedgerRequest::new(ledger::LedgerEvent::ScanDebited)
            // One certificate, one spend, however many times it is fetched.
            .unique(),
        _ => return Ok(()),
    };

    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return Ok(());
    };
    if value.get("status").and_then(|status| status.as_str()) != Some("OK") {
        return Ok(());
    }

    let payload = value.get("payload");
    let subject = match command {
        "RUN_SCAN" => payload.and_then(|it| it.get("sessionUuid")),
        _ => payload.and_then(|it| it.get("certificateId")),
    };

    let name = match subject.and_then(|it| it.as_str()) {
        Some(name) => name,
        // An OK answer that names no session or certificate cannot be tied to
        // a transaction, so nothing is claimed about one.
        None => return Ok(()),
    };

    let home = host_process::cyvra_home().map_err(|_| ledger::LedgerError::HomeUnavailable)?;
    let clock = ledger::SystemClock;
    let request = request.subject(name).offline(on_offline_lease(&home));
    ledger::append(&home, request, &clock)?;

    /*
     * A settled scan is recorded in two places on purpose.
     *
     * The revision ledger says *what happened* - the immutable history the
     * desktop view renders. The entitlement journal says *what it cost*, and
     * is what the Host reads back on its next boot, because the signed
     * `payload` it cannot edit. One file proves the spend occurred; the other
     * makes it stick. Neither is sufficient alone.
     *
     * A journal failure is reported and then allowed through: the certificate
     * has already been written and handed to the operator, so refusing their
     * report over a disk error would punish them for it. What they would get
     * is a restored balance on the next launch - and an audit line in
     * `ledger.jsonl` naming the spend, which is exactly the discrepancy an
     * auditor is meant to find rather than have papered over.
     */
    if command == "GET_FINAL_REPORT" {
        match entitlement::record_debit(&home, name, &state::iso8601(clock.now_unix())) {
            Ok(debit) => log::info!("entitlement settled: {}", debit.subject),
            Err(error) => log::warn!("entitlement debit not persisted: {error}"),
        }
    }

    Ok(())
}

/// Reads the revision ledger for the "Transaction Ledger" view.
///
/// Returns the entries **and** the verdict of recomputing their hash chain
/// separately, rather than refusing the read when the chain does not hold. An
/// operator looking at a tampered ledger needs to see what it says - and be
/// told plainly that it no longer checks out - far more than they need an
/// empty screen with no explanation.
///
/// `verified` is `null` when the file does not exist yet: an installation that
/// has never recorded an event has an *absent* ledger, not a broken one, and
/// calling that "unverified" would cry wolf before there was anything to see.
#[tauri::command]
pub async fn ledger_read() -> LedgerReadResult {
    let home = match host_process::cyvra_home() {
        Ok(root) => root,
        Err(error) => {
            return LedgerReadResult {
                entries: Vec::new(),
                verified: None,
                error: Some(error),
                raw: None,
            }
        }
    };

    let entries = match ledger::read_entries(&home) {
        Ok(entries) => entries,
        Err(error) => {
            return LedgerReadResult {
                entries: Vec::new(),
                verified: Some(false),
                error: Some(error.to_string()),
                raw: ledger::read_raw(&home),
            }
        }
    };

    if entries.is_empty() {
        return LedgerReadResult {
            entries: Vec::new(),
            verified: None,
            error: None,
            raw: ledger::read_raw(&home),
        };
    }

    let verified = ledger::verify_chain(&entries).is_ok();

    LedgerReadResult {
        entries,
        verified: Some(verified),
        error: None,
        raw: ledger::read_raw(&home),
    }
}

/// What the ledger view is allowed to see: the entries, whether they chain,
/// and a read failure if the file could not be opened at all.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerReadResult {
    pub entries: Vec<ledger::LedgerEntry>,
    /// `Some(true)`/`Some(false)` once a ledger exists, `None` when there is none.
    pub verified: Option<bool>,
    pub error: Option<String>,
    /// The file verbatim, so the view can parse `ledger.jsonl` for itself.
    ///
    /// `None` when there is no file, which is not a failure: an installation
    /// that has never recorded an event has no history yet, not a missing one.
    pub raw: Option<String>,
}

/// Evaluates device connection state using authoritative Windows USB truth.
///
/// Physical USB state comes from a fresh SetupAPI present-device
/// enumeration ("notification is a trigger, enumeration is truth").
/// The Host receives that state through the GET_DEVICE_STATE payload
/// and must never re-derive it from ADB discovery (FSB-003).
#[tauri::command]
pub async fn get_device_state(
    state: tauri::State<'_, HostState>,
) -> Result<DeviceStateResult, String> {
    #[cfg(windows)]
    {
        let observation = tauri::async_runtime::spawn_blocking(enumerate_usb_devices)
            .await
            .map_err(|error| format!("USB_ENUMERATION_TASK_FAILED: {error}"))?;

        let usb_connected = observation.observation_state == UsbObservationState::UsbPresent;

        let usb_observation_state = match observation.observation_state {
            UsbObservationState::UsbPresent => "USB_PRESENT",
            UsbObservationState::UsbNotPresent => "USB_NOT_PRESENT",
            UsbObservationState::UsbObservationUnknown => "USB_OBSERVATION_UNKNOWN",
        };

        let device_state = {
            let mut manager = state
                .manager
                .lock()
                .map_err(|_| "HOST_STATE_LOCK_FAILED".to_string())?;

            manager.get_device_state(usb_connected, usb_observation_state)?
        };

        Ok(DeviceStateResult {
            connection_state: device_state.connection_state,
            usb_state: device_state.usb_state,
            adb_state: device_state.adb_state,
            adb_available: device_state.adb_available,
            ready_to_scan: device_state.ready_to_scan,
            status_message: device_state.status_message,
            operator_action_required: device_state.operator_action_required,
            device_descriptor: device_state.device_descriptor,
            usb_observation: UsbObservationSummary {
                observation_state: usb_observation_state.to_string(),
                device_count: observation.devices.len(),
                observed_at: observation.observed_at,
                source: observation.source,
            },
        })
    }

    #[cfg(not(windows))]
    {
        let _ = state;

        Err("GET_DEVICE_STATE is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub async fn get_wpd_devices(
    state: tauri::State<'_, HostState>,
) -> Result<Vec<WpdDeviceResult>, String> {
    #[cfg(windows)]
    {
        let devices = tauri::async_runtime::spawn_blocking(enumerate_devices)
            .await
            .map_err(|error| format!("WPD_ENUMERATION_TASK_FAILED: {error}"))??;

        let mut session_ids = state
            .wpd_session_ids
            .lock()
            .map_err(|_| "WPD_SESSION_ID_LOCK_FAILED".to_string())?;

        let mut results = Vec::with_capacity(devices.len());

        for device in devices {
            let session_device_id = session_ids.id_for(&device.pnp_device_id)?;

            results.push(WpdDeviceResult::from_descriptor(device, session_device_id));
        }

        Ok(results)
    }

    #[cfg(not(windows))]
    {
        let _ = state;

        Err(
            "WPD_UNSUPPORTED_PLATFORM: Windows Portable Devices are only available on Windows"
                .to_string(),
        )
    }
}

#[tauri::command]
pub async fn scan_wpd_device_metadata(
    state: tauri::State<'_, HostState>,
    session_device_id: String,
) -> Result<crate::wpd::scanner::WpdScanResult, String> {
    #[cfg(windows)]
    {
        use crate::wpd::discovery::enumerate_devices;
        use crate::wpd::scanner::{scan_device_metadata, WPD_SCAN_OPEN_FAILED};
        use windows::{
            core::PCWSTR,
            Win32::{
                Devices::PortableDevices::{
                    IPortableDevice, IPortableDeviceValues, PortableDeviceFTM,
                    PortableDeviceValues, WPD_CLIENT_DESIRED_ACCESS,
                },
                Foundation::GENERIC_READ,
                System::Com::{
                    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                    COINIT_MULTITHREADED,
                },
            },
        };

        // Look up PnP device ID from session ID
        let session_ids = state
            .wpd_session_ids
            .lock()
            .map_err(|_| "WPD_SESSION_ID_LOCK_FAILED".to_string())?;

        let pnp_device_id = session_ids
            .by_pnp_device_id
            .iter()
            .find(|(_, sid)| **sid == session_device_id)
            .map(|(id, _)| id.clone())
            .ok_or_else(|| "WPD_SESSION_NOT_FOUND".to_string())?;

        drop(session_ids);

        // Initialize COM
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|e| format!("WPD_COM_INIT_FAILED: {}", e))?;

        // Open device with GENERIC_READ
        let client_info: IPortableDeviceValues =
            unsafe { CoCreateInstance(&PortableDeviceValues, None, CLSCTX_INPROC_SERVER) }
                .map_err(|e| format!("{}: {}", WPD_SCAN_OPEN_FAILED, e))?;

        unsafe { client_info.SetUnsignedIntegerValue(&WPD_CLIENT_DESIRED_ACCESS, GENERIC_READ.0) }
            .map_err(|e| format!("{}: {}", WPD_SCAN_OPEN_FAILED, e))?;

        let device: IPortableDevice =
            unsafe { CoCreateInstance(&PortableDeviceFTM, None, CLSCTX_INPROC_SERVER) }
                .map_err(|e| format!("{}: {}", WPD_SCAN_OPEN_FAILED, e))?;

        let pnp_wide: Vec<u16> = pnp_device_id
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        unsafe { device.Open(PCWSTR::from_raw(pnp_wide.as_ptr()), &client_info) }
            .map_err(|e| format!("{}: {}", WPD_SCAN_OPEN_FAILED, e))?;

        // Get device metadata for the result
        let devices = enumerate_devices()?;
        let device_descriptor = devices
            .iter()
            .find(|d| d.pnp_device_id.eq_ignore_ascii_case(&pnp_device_id));

        let friendly_name = device_descriptor.and_then(|d| d.friendly_name.clone());
        let manufacturer = device_descriptor.and_then(|d| d.manufacturer.clone());

        // Perform the scan
        let result = scan_device_metadata(&device, &session_device_id, friendly_name, manufacturer);

        // Close device
        unsafe { device.Close() }.ok();
        unsafe { CoUninitialize() };

        result
    }

    #[cfg(not(windows))]
    {
        let _ = (state, session_device_id);
        Err("WPD_UNSUPPORTED_PLATFORM".to_string())
    }
}
