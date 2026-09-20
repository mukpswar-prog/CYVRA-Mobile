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
