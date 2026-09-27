use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env,
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const PROTOCOL_VERSION: &str = "1";
const HOST_COMMAND: &str = "GET_HOST_INFO";
const DEVICE_STATE_COMMAND: &str = "GET_DEVICE_STATE";
const HOST_MAIN_CLASS: &str = "cyvra.mobile.host.protocol.HostMain";

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostRequest {
    protocol_version: String,
    request_id: String,
    command: String,
    payload: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostError {
    code: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostResponse {
    protocol_version: String,
    request_id: String,
    status: String,
    host_version: String,
    #[serde(default)]
    payload: Value,
    error: Option<HostError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub protocol_version: String,
    pub request_id: String,
    pub host_version: String,
}

/// Host-evaluated device connection state (FSB-003).
///
/// `usb_state` reflects physical USB truth supplied by the Rust Windows
/// USB plane. It is never re-derived from ADB device discovery.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceState {
    pub connection_state: String,
    pub usb_state: String,
    pub adb_state: String,
    pub adb_available: bool,
    pub ready_to_scan: bool,
    pub status_message: String,
    pub operator_action_required: Option<String>,
    pub device_descriptor: Option<Value>,
    pub usb_observation_state: String,
}

fn payload_string(payload: &Value, key: &str) -> Result<String, String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "HOST_INVALID_RESPONSE: payload.{} is missing or not a string",
                key
            )
        })
}

fn payload_bool(payload: &Value, key: &str) -> Result<bool, String> {
    payload
        .get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| {
            format!(
                "HOST_INVALID_RESPONSE: payload.{} is missing or not a boolean",
                key
            )
        })
}

fn payload_optional_string(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub struct HostProcessManager {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
}

impl HostProcessManager {
    pub fn new() -> Self {
        Self {
            child: None,
            stdin: None,
            stdout: None,
        }
    }

    pub fn get_host_info(&mut self) -> Result<HostInfo, String> {
        let request_id = format!(
            "d2.1-{}",
            REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        );

        let request = HostRequest {
            protocol_version: PROTOCOL_VERSION.to_string(),
            request_id: request_id.clone(),
            command: HOST_COMMAND.to_string(),
            payload: json!({}),
        };

        let response = self.send_request(&request)?;
        let response = Self::validate_envelope(response, &request_id)?;

        Ok(HostInfo {
            protocol_version: response.protocol_version,
            request_id: response.request_id,
            host_version: response.host_version,
        })
    }

    /// Asks the Host to evaluate device connection state.
    ///
    /// `usb_connected` and `usb_observation_state` are supplied by the
    /// Rust Windows USB plane (SetupAPI present-device enumeration).
    ///
    /// The Host must not infer physical USB state from ADB discovery
    /// (FSB-003; canonical guideline 8.3).
    pub fn get_device_state(
        &mut self,
        usb_connected: bool,
        usb_observation_state: &str,
    ) -> Result<DeviceState, String> {
        let request_id = format!(
            "d2.1-{}",
            REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        );

        let request = HostRequest {
            protocol_version: PROTOCOL_VERSION.to_string(),
            request_id: request_id.clone(),
            command: DEVICE_STATE_COMMAND.to_string(),
            payload: json!({
                "usbConnected": usb_connected,
                "usbObservationState": usb_observation_state,
            }),
        };

        let response = self.send_request(&request)?;
        let response = Self::validate_envelope(response, &request_id)?;

        let payload = &response.payload;

        Ok(DeviceState {
            connection_state: payload_string(payload, "connectionState")?,
            usb_state: payload_string(payload, "usbState")?,
            adb_state: payload_string(payload, "adbState")?,
            adb_available: payload_bool(payload, "adbAvailable")?,
            ready_to_scan: payload_bool(payload, "readyToScan")?,
            status_message: payload_string(payload, "statusMessage")?,
            operator_action_required: payload_optional_string(
                payload,
                "operatorActionRequired",
            ),
            device_descriptor: payload.get("device").cloned(),
            usb_observation_state: payload_string(
                payload,
                "usbObservationState",
            )?,
        })
    }

    fn validate_envelope(
        response: HostResponse,
        expected_request_id: &str,
    ) -> Result<HostResponse, String> {
        if response.protocol_version != PROTOCOL_VERSION {
            return Err(format!(
                "HOST_PROTOCOL_MISMATCH: expected protocol {}, received {}",
                PROTOCOL_VERSION, response.protocol_version
            ));
        }

        if response.request_id != expected_request_id {
            return Err(format!(
                "HOST_REQUEST_ID_MISMATCH: expected {}, received {}",
                expected_request_id, response.request_id
            ));
        }

        if response.status != "OK" {
            let error = response
                .error
                .map(|e| format!("{}: {}", e.code, e.message))
                .unwrap_or_else(|| {
                    "Host returned ERROR without structured error".to_string()
                });

            return Err(format!("HOST_ERROR: {}", error));
        }

        if response.host_version.trim().is_empty() {
            return Err("HOST_INVALID_RESPONSE: hostVersion is empty".to_string());
        }

        Ok(response)
    }

    fn send_request(
        &mut self,
        request: &HostRequest,
    ) -> Result<HostResponse, String> {
        self.ensure_started()?;

        let encoded = serde_json::to_string(request)
            .map_err(|e| {
                format!("HOST_REQUEST_SERIALIZATION_FAILED: {}", e)
            })?;

        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| {
                "HOST_PROCESS_NOT_READY: stdin unavailable".to_string()
            })?;

        stdin
            .write_all(encoded.as_bytes())
            .map_err(|e| format!("HOST_WRITE_FAILED: {}", e))?;

        stdin
            .write_all(b"\n")
            .map_err(|e| format!("HOST_WRITE_FAILED: {}", e))?;

        stdin
            .flush()
            .map_err(|e| format!("HOST_FLUSH_FAILED: {}", e))?;

        let stdout = self
            .stdout
            .as_mut()
            .ok_or_else(|| {
                "HOST_PROCESS_NOT_READY: stdout unavailable".to_string()
            })?;

        let mut line = String::new();

        let bytes = stdout
            .read_line(&mut line)
            .map_err(|e| format!("HOST_READ_FAILED: {}", e))?;

        if bytes == 0 {
            self.stop();

            return Err(
                "HOST_PROCESS_CLOSED: Host exited before returning a response"
                    .to_string()
            );
        }

        serde_json::from_str::<HostResponse>(line.trim())
            .map_err(|e| {
                format!("HOST_RESPONSE_INVALID_JSON: {}", e)
            })
    }

    fn ensure_started(&mut self) -> Result<(), String> {
        if let Some(child) = self.child.as_mut() {
            match child.try_wait() {
                Ok(None) => return Ok(()),
                Ok(Some(status)) => {
                    self.stop();

                    return Err(format!(
                        "HOST_PROCESS_EXITED: Host exited before request (status {})",
                        status
                    ));
                }
                Err(error) => {
                    self.stop();

                    return Err(format!(
                        "HOST_PROCESS_STATE_FAILED: {}",
                        error
                    ));
                }
            }
        }

        self.start()
    }

    fn start(&mut self) -> Result<(), String> {
        let (java_path, classpath) = resolve_host_runtime()?;

        let mut command = Command::new(&java_path);

        command
            .arg("-classpath")
            .arg(&classpath)
            .arg(HOST_MAIN_CLASS);

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| {
                format!(
                    "HOST_PROCESS_START_FAILED: could not start {}: {}",
                    java_path.display(),
                    error
                )
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| {
                "HOST_PROCESS_START_FAILED: stdin pipe unavailable"
                    .to_string()
            })?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| {
                "HOST_PROCESS_START_FAILED: stdout pipe unavailable"
                    .to_string()
            })?;

        self.child = Some(child);
        self.stdin = Some(stdin);
        self.stdout = Some(BufReader::new(stdout));

        Ok(())
    }

    fn stop(&mut self) {
        self.stdin = None;
        self.stdout = None;

        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for HostProcessManager {
    fn drop(&mut self) {
        self.stop();
    }
}

fn resolve_host_runtime() -> Result<(PathBuf, String), String> {
    let host_install = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../host/build/install/cyvra-mobile-host");

    let lib_dir = host_install.join("lib");

    if !lib_dir.is_dir() {
        return Err(format!(
            "HOST_NOT_BUILT: expected Host library directory at {}. Run :host:installDist first.",
            lib_dir.display()
        ));
    }

    let mut jars = fs::read_dir(&lib_dir)
        .map_err(|error| {
            format!(
                "HOST_CLASSPATH_READ_FAILED: could not read {}: {}",
                lib_dir.display(),
                error
            )
        })?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.eq_ignore_ascii_case("jar"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    jars.sort();

    if jars.is_empty() {
        return Err(format!(
            "HOST_CLASSPATH_EMPTY: no JARs found in {}",
            lib_dir.display()
        ));
    }

    let classpath = jars
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(";");

    let java_path = resolve_java_executable()?;

    Ok((java_path, classpath))
}

fn resolve_java_executable() -> Result<PathBuf, String> {
    if let Ok(java_home) = env::var("JAVA_HOME") {
        let java_home = PathBuf::from(java_home.trim_matches('"'));

        let java_exe = java_home.join("bin").join("java.exe");

        if java_exe.is_file() {
            return Ok(java_exe);
        }

        return Err(format!(
            "JAVA_HOME_INVALID: expected Java executable at {}",
            java_exe.display()
        ));
    }

    Ok(PathBuf::from("java.exe"))
}

#[cfg(all(test, windows))]
mod tests {
    use super::HostProcessManager;
    use crate::usb::model::UsbObservationState;

    /// FSB-003 hardware validation.
    ///
    /// Requires the acceptance Samsung A10s physically connected with
    /// USB debugging disabled, plus `:host:installDist` built.
    ///
    /// Expected outcome: native USB truth reaches the Host through the
    /// GET_DEVICE_STATE payload and evaluates to USB_DETECTED.
    /// The ADB-derived path must never produce NO_DEVICE here.
    #[test]
    #[ignore = "requires the connected Samsung A10s with USB debugging disabled"]
    fn device_state_with_adb_disabled_reports_usb_detected() {
        let observation = crate::usb::enumerate::enumerate_usb_devices();

        println!("observation_state={:?}", observation.observation_state);
        println!("device_count={}", observation.devices.len());

        for device in &observation.devices {
            println!("device={}", device.device_path);
        }

        let phone_present = observation
            .devices
            .iter()
            .any(|device| device.device_path.contains("VID_04E8"));

        assert!(
            phone_present,
            "A10s (VID_04E8) must be present via SetupAPI while ADB is disabled"
        );

        assert_eq!(
            observation.observation_state,
            UsbObservationState::UsbPresent
        );

        let usb_connected =
            observation.observation_state == UsbObservationState::UsbPresent;

        let mut manager = HostProcessManager::new();

        let state = manager
            .get_device_state(usb_connected, "USB_PRESENT")
            .expect("GET_DEVICE_STATE should succeed against the built Host");

        println!("connection_state={}", state.connection_state);
        println!("usb_state={}", state.usb_state);
        println!("adb_state={}", state.adb_state);
        println!("adb_available={}", state.adb_available);
        println!("ready_to_scan={}", state.ready_to_scan);
        println!("status_message={}", state.status_message);
        println!("usb_observation_state={}", state.usb_observation_state);

        assert_eq!(state.usb_observation_state, "USB_PRESENT");
        assert_eq!(state.usb_state, "USB_CONNECTED");
        assert_eq!(state.connection_state, "USB_DETECTED");
        assert!(!state.ready_to_scan);
    }
}
