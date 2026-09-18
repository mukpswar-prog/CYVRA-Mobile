use std::sync::Mutex;

use serde::Serialize;

use crate::host_process::{HostInfo, HostProcessManager};

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
