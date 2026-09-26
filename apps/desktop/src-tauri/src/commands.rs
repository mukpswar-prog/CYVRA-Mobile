use std::{collections::HashMap, sync::Mutex};

use serde::Serialize;

use crate::host_process::{HostInfo, HostProcessManager};

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

        return Ok(results);
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
            CoCreateInstance, CoInitializeEx, CoUninitialize,
            CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
        },
    },
};

        // Look up PnP device ID from session ID
        let session_ids = state.wpd_session_ids.lock()
            .map_err(|_| "WPD_SESSION_ID_LOCK_FAILED".to_string())?;

        let pnp_device_id = session_ids.by_pnp_device_id.iter()
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

        let pnp_wide: Vec<u16> = pnp_device_id.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe { device.Open(PCWSTR::from_raw(pnp_wide.as_ptr()), &client_info) }
            .map_err(|e| format!("{}: {}", WPD_SCAN_OPEN_FAILED, e))?;

        // Get device metadata for the result
        let devices = enumerate_devices()?;
        let device_descriptor = devices.iter()
            .find(|d| d.pnp_device_id.to_ascii_lowercase() == pnp_device_id.to_ascii_lowercase());

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
