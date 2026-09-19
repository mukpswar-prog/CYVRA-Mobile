use std::sync::Mutex;

use serde::Serialize;

use crate::host_process::{HostInfo, HostProcessManager};

#[cfg(windows)]
use crate::wpd::discovery::{enumerate_devices, WpdDeviceDescriptor};

pub struct HostState {
    pub manager: Mutex<HostProcessManager>,
}

impl HostState {
    pub fn new() -> Self {
        Self {
            manager: Mutex::new(HostProcessManager::new()),
        }
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
    pub pnp_device_id: String,
    pub friendly_name: Option<String>,
    pub manufacturer: Option<String>,
    pub description: Option<String>,
}

#[cfg(windows)]
impl From<WpdDeviceDescriptor> for WpdDeviceResult {
    fn from(value: WpdDeviceDescriptor) -> Self {
        Self {
            pnp_device_id: value.pnp_device_id,
            friendly_name: value.friendly_name,
            manufacturer: value.manufacturer,
            description: value.description,
        }
    }
}

#[tauri::command]
pub async fn get_host_info(
    state: tauri::State<'_, HostState>,
) -> Result<HostInfoResult, String> {
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
pub async fn get_wpd_devices() -> Result<Vec<WpdDeviceResult>, String> {
    #[cfg(windows)]
    {
        let devices =
            tauri::async_runtime::spawn_blocking(enumerate_devices)
                .await
                .map_err(|error| {
                    format!(
                        "WPD_ENUMERATION_TASK_FAILED: {error}"
                    )
                })??;

        return Ok(
            devices
                .into_iter()
                .map(WpdDeviceResult::from)
                .collect(),
        );
    }

    #[cfg(not(windows))]
    {
        Err(
            "WPD_UNSUPPORTED_PLATFORM: Windows Portable Devices are only available on Windows"
                .to_string(),
        )
    }
}
