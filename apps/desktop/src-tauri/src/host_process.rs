use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
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
const PREFLIGHT_COMMAND: &str = "GET_PREFLIGHT";
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

/// Rejects anything that is not shaped like a `HostCommand` value.
///
/// Every one of the Host's thirteen commands matches `[A-Z0-9_]+`, so a name
/// that does not can be refused here with a precise message instead of being
/// written to the Host's stdin and surfacing as a decode failure on the far side.
fn validate_command_name(command: &str) -> Result<(), String> {
    if command.is_empty() {
        return Err("HOST_COMMAND_INVALID: command is empty".to_string());
    }

    if !command
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
    {
        return Err(format!(
            "HOST_COMMAND_INVALID: {command} must match [A-Z0-9_]+"
        ));
    }

    Ok(())
}

/// Builds the single JSON-lines request envelope for an arbitrary command.
///
/// Split out from [`HostProcessManager::send_host_command`] so the wire format
/// itself - protocol version, request id, command and payload, all on one line -
/// can be asserted without a running Host.
fn build_host_request(
    command: &str,
    payload: &str,
) -> Result<(String, HostRequest), String> {
    validate_command_name(command)?;

    let payload_value: Value = serde_json::from_str(payload).map_err(|error| {
        format!("HOST_PAYLOAD_INVALID_JSON: {error}")
    })?;

    if !payload_value.is_object() {
        return Err(format!(
            "HOST_PAYLOAD_INVALID: payload must be a JSON object, received {payload_value}"
        ));
    }

    let request_id = format!(
        "d2.1-{}",
        REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    Ok((
        request_id.clone(),
        HostRequest {
            protocol_version: PROTOCOL_VERSION.to_string(),
            request_id,
            command: command.to_string(),
            payload: payload_value,
        },
    ))
}

/// Checks that an answer really belongs to the request that was sent.
///
/// Deliberately does **not** look at `status`: a refusal is a valid answer.
/// Split out from [`HostProcessManager::send_host_command`] so the one
/// documented exception below can be asserted without booting a JVM.
fn validate_response_envelope(
    response: &HostResponse,
    expected_request_id: &str,
) -> Result<(), String> {
    if response.protocol_version != PROTOCOL_VERSION {
        return Err(format!(
            "HOST_PROTOCOL_MISMATCH: expected protocol {}, received {}",
            PROTOCOL_VERSION, response.protocol_version
        ));
    }

    /*
     * The Host echoes the request id so a desynchronised pipe - reading an
     * answer that belongs to an earlier request - is caught instead of being
     * shown as though it answered this one.
     *
     * `INVALID_REQUEST` is the documented exception: the Host emits it only
     * when it could not decode the request at all, so it never saw an id to
     * echo and answers with `"unknown"`. Failing the check there would hide a
     * precise, readable Host refusal behind a bridge error, which is exactly
     * what this method exists not to do.
     */
    let host_could_not_read_the_request = response.status == "ERROR"
        && response.error.as_ref().map(|error| error.code.as_str())
            == Some("INVALID_REQUEST");

    if response.request_id != expected_request_id && !host_could_not_read_the_request {
        return Err(format!(
            "HOST_REQUEST_ID_MISMATCH: expected {}, received {}",
            expected_request_id, response.request_id
        ));
    }

    if response.host_version.trim().is_empty() {
        return Err("HOST_INVALID_RESPONSE: hostVersion is empty".to_string());
    }

    Ok(())
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

    /// Runs Host-side preflight (§16) and returns the raw payload.
    ///
    /// Preflight exercises the Java runtime the JVM is running on *and* the
    /// ADB binary the Host resolves through its platform-tools locator, so a
    /// passing result is direct evidence that both were correctly bundled (P1).
    pub fn get_preflight(&mut self) -> Result<Value, String> {
        let request_id = format!(
            "d2.1-{}",
            REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        );

        let request = HostRequest {
            protocol_version: PROTOCOL_VERSION.to_string(),
            request_id: request_id.clone(),
            command: PREFLIGHT_COMMAND.to_string(),
            payload: json!({}),
        };

        let response = self.send_request(&request)?;
        let response = Self::validate_envelope(response, &request_id)?;

        Ok(response.payload)
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
        self.send_request_line(request)
            .map(|(_line, response)| response)
    }

    /// Writes one request line and reads exactly one response line.
    ///
    /// Returns the raw line alongside the decoded envelope so callers that must
    /// show the Host's answer verbatim - [`Self::send_host_command`] - do not
    /// have to re-serialize it. Re-serializing would silently normalise field
    /// order and formatting, which is still "what the Host said" but no longer
    /// the bytes the Host actually produced.
    fn send_request_line(
        &mut self,
        request: &HostRequest,
    ) -> Result<(String, HostResponse), String> {
        self.ensure_started()?;

        let encoded = serde_json::to_string(request)
            .map_err(|e| {
                format!("HOST_REQUEST_SERIALIZATION_FAILED: {}", e)
            })?;

        {
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
        }

        /*
         * The Host writes exactly one JSON line per request, so a blank line is
         * never the answer. Skipping a few of them rather than failing keeps a
         * stray newline from being reported as malformed JSON, which would read
         * to an operator as a broken Host when the pipe is in fact fine.
         */
        const MAX_BLANK_LINES: usize = 4;

        for _ in 0..=MAX_BLANK_LINES {
            let mut line = String::new();

            let bytes = {
                let stdout = self
                    .stdout
                    .as_mut()
                    .ok_or_else(|| {
                        "HOST_PROCESS_NOT_READY: stdout unavailable"
                            .to_string()
                    })?;

                stdout
                    .read_line(&mut line)
                    .map_err(|e| format!("HOST_READ_FAILED: {}", e))?
            };

            if bytes == 0 {
                self.stop();

                return Err(
                    "HOST_PROCESS_CLOSED: Host exited before returning a response"
                        .to_string()
                );
            }

            let trimmed = line.trim_end();

            if trimmed.is_empty() {
                continue;
            }

            let response = serde_json::from_str::<HostResponse>(trimmed)
                .map_err(|e| format!("HOST_RESPONSE_INVALID_JSON: {}", e))?;

            return Ok((trimmed.to_string(), response));
        }

        Err(
            "HOST_RESPONSE_INVALID_JSON: Host produced no non-empty line"
                .to_string()
        )
    }

    /// Sends any protocol command and returns the Host's response line verbatim.
    ///
    /// The envelope is still checked for integrity - protocol version, echoed
    /// request id and a non-empty `hostVersion` - but `status` is deliberately
    /// *not* checked here. `LICENSE_REQUIRED`, `SANITIZE_PHRASE_MISMATCH` and the
    /// decision D-1 `BLOCKED_*` answers are legitimate protocol outcomes that the
    /// UI has to render accurately, so collapsing them into `Err` would erase the
    /// difference between "the Host refused" and "the Host is unreachable".
    ///
    /// * `Ok(line)` - the Host answered, whatever its status.
    /// * `Err` - the bridge itself failed (no process, dead pipe, bad envelope).
    pub fn send_host_command(
        &mut self,
        command: &str,
        payload: &str,
    ) -> Result<String, String> {
        let (request_id, request) = build_host_request(command, payload)?;

        let (line, response) = self.send_request_line(&request)?;

        validate_response_envelope(&response, &request_id)?;

        Ok(line.to_string())
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
        let runtime = resolve_host_runtime()?;

        let mut command = Command::new(&runtime.java_path);

        /*
         * The Host never derives its own resource locations from the process
         * working directory (which differs between `tauri dev`, an installed
         * run and a support run from a shortcut). The installer root is passed
         * explicitly so bundled ADB and any future resources resolve the same
         * way everywhere.
         */
        command
            .arg(format!(
                "-Dcyvra.home={}",
                runtime.resource_root.display()
            ))
            .arg("-classpath")
            .arg(&runtime.classpath)
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
                    runtime.java_path.display(),
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

/// Environment override for a relocated or portable installation root.
///
/// Points at the directory that contains `host/lib` and `runtime/`.
const HOME_ENV: &str = "CYVRA_HOME";

/// Relative location of the Java runtime shipped inside the installer.
const RUNTIME_DIR: &str = "runtime";

/// Everything needed to spawn `HostMain`.
pub struct HostRuntime {
    /// Installation root, handed to the JVM as `-Dcyvra.home=`.
    pub resource_root: PathBuf,
    pub java_path: PathBuf,
    pub classpath: String,
}

/// Directory containing the running executable.
fn exe_dir() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Development-tree Host distribution, for contributors running from source.
///
/// Compiled out of release builds so a shipped executable can never embed a
/// build-machine path (P1 exit gate: no `CARGO_MANIFEST_DIR` in the artifact).
#[cfg(debug_assertions)]
fn dev_tree_host_root() -> Option<PathBuf> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../host/build/install/cyvra-mobile-host");

    root.join("lib").is_dir().then_some(root)
}

#[cfg(not(debug_assertions))]
fn dev_tree_host_root() -> Option<PathBuf> {
    None
}

/// Candidate installation roots, most specific first.
///
/// The installer layout wins over every other guess so an installed copy never
/// reaches back into a source checkout.
fn installation_roots() -> Vec<PathBuf> {
    let exe = exe_dir();
    let mut roots = Vec::new();

    if let Ok(home) = env::var(HOME_ENV) {
        let home = PathBuf::from(home.trim_matches('"'));

        if !home.as_os_str().is_empty() {
            roots.push(home);
        }
    }

    // Tauri `$RESOURCES` next to the executable: <install>/resources/host/lib
    roots.push(exe.join("resources"));
    // Flattened resource root: <install>/host/lib
    roots.push(exe.clone());
    // Sibling resource root: <install>/../resources/host/lib
    roots.push(exe.join("../resources"));

    roots
}

/// Locates the Host `lib` directory together with its installation root.
fn locate_host() -> Result<(PathBuf, PathBuf), String> {
    for root in installation_roots() {
        let lib = root.join("host").join("lib");

        if lib.is_dir() {
            return Ok((root, lib));
        }
    }

    if let Some(root) = dev_tree_host_root() {
        return Ok((root.clone(), root.join("lib")));
    }

    Err(format!(
        "HOST_NOT_BUILT: Host runtime not found. Expected <install>/resources/host/lib \
         beside {}, or set {} to an installation root. \
         Run `:host:installDist` when building from source.",
        exe_dir().display(),
        HOME_ENV
    ))
}

/// Resolves the Java launcher: bundled runtime, then `JAVA_HOME`, then `PATH`.
fn resolve_java_executable(resource_root: &Path) -> Result<PathBuf, String> {
    let bundled = resource_root
        .join(RUNTIME_DIR)
        .join("bin")
        .join("java.exe");

    if bundled.is_file() {
        return Ok(bundled);
    }

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

fn resolve_host_runtime() -> Result<HostRuntime, String> {
    let (resource_root, lib_dir) = locate_host()?;

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

    let java_path = resolve_java_executable(&resource_root)?;

    Ok(HostRuntime {
        resource_root,
        java_path,
        classpath,
    })
}

/// Boots the Host against the resolved runtime and performs one round-trip.
///
/// Serves the installer's first-run preflight and the CI packaging gate: an
/// artifact is only publishable when this succeeds against the *installed*
/// layout (P1 exit gate), because it proves the bundled JARs and Java runtime
/// are both present and complete.
pub fn run_selftest() -> Result<String, String> {
    let runtime = resolve_host_runtime()?;

    let jar_count = runtime.classpath.split(';').count();

    let mut manager = HostProcessManager::new();
    let info = manager.get_host_info()?;

    /*
     * Preflight is what makes this a packaging gate rather than a smoke test:
     * it runs inside the bundled JVM and resolves the bundled adb, so the
     * report reflects the installed layout instead of this build machine.
     */
    let preflight = manager.get_preflight()?;
    let ready = payload_bool(&preflight, "readyToScan")?;

    let adb = preflight
        .get("checks")
        .and_then(Value::as_array)
        .and_then(|checks| {
            checks.iter().find(|check| {
                check.get("checkName").and_then(Value::as_str)
                    == Some("ADB Component")
            })
        })
        .and_then(|check| check.get("details").and_then(Value::as_str))
        .unwrap_or("ADB Component not reported")
        .to_string();

    let report = format!(
        "protocol={} hostVersion={} jars={} java={} home={} \
         readyToScan={} adb={}",
        info.protocol_version,
        info.host_version,
        jar_count,
        runtime.java_path.display(),
        runtime.resource_root.display(),
        ready,
        adb,
    );

    if !ready {
        return Err(format!("SELFTEST_NOT_READY: {report}"));
    }

    Ok(format!("SELFTEST_OK {report}"))
}

/// Runtime-resolution guarantees for the installed layout (P1).
#[cfg(test)]
mod runtime_resolution_tests {
    use super::*;
    use std::fs;

    /// The installer layout must always be among the searched candidates, and
    /// it must be searched before any parent-directory guess.
    #[test]
    fn candidate_roots_cover_the_installer_layout() {
        let roots = installation_roots();

        assert!(
            roots.len() >= 3,
            "expected at least three candidate roots, got {roots:?}"
        );

        let resource_roots = roots
            .iter()
            .filter(|root| {
                root.file_name()
                    .map(|name| name.eq_ignore_ascii_case("resources"))
                    .unwrap_or(false)
            })
            .count();

        assert!(
            resource_roots >= 1,
            "no candidate root named 'resources': {roots:?}"
        );
    }

    /// Resolves a Host distribution, failing loudly in CI.
    ///
    /// CI stages `.resources/` (which runs `:host:installDist`) *before* the
    /// Rust tests, so a failure there means the packaging pipeline is broken
    /// and must not be waved through. Outside CI a fresh checkout legitimately
    /// has neither a staged payload nor installDist output, so the test reports
    /// why and steps aside instead of failing for a reason unrelated to its
    /// subject.
    #[cfg(debug_assertions)]
    fn resolve_or_explain(test_name: &str) -> Option<(PathBuf, PathBuf)> {
        match locate_host() {
            Ok(resolved) => Some(resolved),
            Err(error) if std::env::var_os("CI").is_some() => {
                panic!("{test_name}: CI must stage a Host distribution before running tests: {error}")
            }
            Err(error) => {
                eprintln!("SKIP {test_name}: {error}");
                None
            }
        }
    }

    /// A staged source checkout must resolve a Host distribution carrying at
    /// least one JAR.
    ///
    /// The shape differs by origin: Tauri stages `bundle.resources` next to the
    /// test binary (`<root>/host/lib`), while the development-tree fallback
    /// points straight at `:host:installDist` output (`<root>/lib`). Both are
    /// valid, so the guarantee asserted here is containment under the root
    /// plus a usable distribution.
    #[cfg(debug_assertions)]
    #[test]
    fn source_checkouts_resolve_the_host_distribution() {
        let Some((root, lib)) = resolve_or_explain("source_checkouts_resolve_the_host_distribution")
        else {
            return;
        };

        assert!(lib.is_dir());
        assert!(
            lib.starts_with(&root),
            "resolved lib {lib:?} must live under its root {root:?}"
        );

        let jar_count = fs::read_dir(&lib)
            .expect("host lib directory must be readable")
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .map(|ext| ext.eq_ignore_ascii_case("jar"))
                    .unwrap_or(false)
            })
            .count();

        assert!(jar_count >= 1, "expected at least one Host JAR in {lib:?}");
    }

    /// The development-tree fallback must still find `:host:installDist`
    /// output when no installed layout is present, because it is the only
    /// path available to contributors who never staged installer resources.
    #[cfg(debug_assertions)]
    #[test]
    fn development_tree_fallback_finds_the_installed_distribution() {
        let Some(_) = resolve_or_explain("development_tree_fallback_finds_the_installed_distribution")
        else {
            return;
        };

        let root = dev_tree_host_root()
            .expect("dev tree fallback should find :host:installDist output");

        assert!(
            root.join("lib").is_dir(),
            "dev tree root {root:?} has no lib directory"
        );
    }

    /// Release builds must never fall back to the build machine's source tree,
    /// otherwise the shipped executable embeds a `CARGO_MANIFEST_DIR` path.
    #[cfg(not(debug_assertions))]
    #[test]
    fn release_builds_have_no_development_fallback() {
        assert!(dev_tree_host_root().is_none());
    }

    /// When the installer ships a Java runtime, that runtime always wins over
    /// `JAVA_HOME` and over anything on `PATH`.
    #[test]
    fn bundled_java_runtime_wins_over_java_home() {
        let root = std::env::temp_dir()
            .join(format!("cyvra-runtime-test-{}", std::process::id()));

        let bin = root.join("runtime").join("bin");
        fs::create_dir_all(&bin).expect("create fake runtime");
        let bundled = bin.join("java.exe");
        fs::write(&bundled, b"stub").expect("write fake java");

        let resolved = resolve_java_executable(&root)
            .expect("bundled runtime must be selected");

        assert_eq!(resolved, bundled);

        let _ = fs::remove_dir_all(&root);
    }

    /// Without a bundled runtime the resolution must never invent a Java path:
    /// it falls back to `JAVA_HOME`/`PATH`, or reports a precise error.
    #[test]
    fn unbundled_runtime_never_yields_a_fake_java_path() {
        let root = std::env::temp_dir()
            .join(format!("cyvra-runtime-absent-{}", std::process::id()));

        fs::create_dir_all(&root).expect("create empty root");

        let fake = root.join("runtime").join("bin").join("java.exe");

        match resolve_java_executable(&root) {
            Ok(path) => assert_ne!(
                path, fake,
                "resolution returned a runtime that was never staged"
            ),
            Err(message) => assert!(
                message.starts_with("JAVA_HOME_INVALID"),
                "unexpected failure mode: {message}"
            ),
        }

        let _ = fs::remove_dir_all(&root);
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{DeviceState, HostProcessManager};
    use crate::usb::model::UsbObservationState;
    use std::path::PathBuf;
    use std::process::Command;

    /// Locates the adb CLI for the environment probe.
    ///
    /// Probe only — production ADB discovery is not touched by this.
    fn resolve_adb() -> PathBuf {
        for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
            if let Ok(sdk) = std::env::var(var) {
                let candidate = PathBuf::from(sdk).join("platform-tools").join("adb.exe");
                if candidate.exists() {
                    return candidate;
                }
            }
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let candidate = PathBuf::from(local)
                .join("Android")
                .join("Sdk")
                .join("platform-tools")
                .join("adb.exe");
            if candidate.exists() {
                return candidate;
            }
        }
        PathBuf::from("adb")
    }

    /// Environment oracle for the ADB-OFF / ADB-ON runtime legs.
    ///
    /// Reports whether an authorized ADB device is attached by asking the
    /// adb CLI directly. This is deliberately independent of the production
    /// GET_DEVICE_STATE payload under test: a genuine payload failure can
    /// never be masked by the probe, and each leg skips only when its own
    /// required environment is absent.
    fn authorized_adb_device_present() -> bool {
        let adb = resolve_adb();
        let output = match Command::new(&adb).arg("devices").output() {
            Ok(out) => out,
            Err(err) => {
                println!(
                    "ADB_ENV_PROBE=unavailable ({}: {}) -> no authorized ADB device",
                    adb.display(),
                    err
                );
                return false;
            }
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let authorized = stdout.lines().any(|line| {
            let mut fields = line.split_whitespace();
            let _serial = fields.next();
            fields.next() == Some("device")
        });
        println!("ADB_ENV_PROBE=authorized_device_present={}", authorized);
        authorized
    }

    /// Shared FSB-003 hardware prelude for both runtime legs.
    ///
    /// Requires the acceptance Samsung A10s physically connected
    /// (VID_04E8 visible through SetupAPI) plus `:host:installDist` built.
    ///
    /// Proves the native USB truth before any state expectation: SetupAPI
    /// must report the phone with observation state USB_PRESENT, and that
    /// fact is what reaches the Host through GET_DEVICE_STATE.
    fn fsb003_usb_prelude() -> (bool, HostProcessManager) {
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
            "A10s (VID_04E8) must be present via SetupAPI"
        );

        assert_eq!(
            observation.observation_state,
            UsbObservationState::UsbPresent
        );

        let usb_connected = observation.observation_state == UsbObservationState::UsbPresent;

        (usb_connected, HostProcessManager::new())
    }

    /// Queries GET_DEVICE_STATE and prints the full payload for the record.
    fn query_device_state(manager: &mut HostProcessManager, usb_connected: bool) -> DeviceState {
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

        state
    }

    /// FSB-003 USB invariants — must hold in BOTH runtime states.
    ///
    /// ADB enrichment never changes the USB truth (REQ-DEV-011: ADB is
    /// never a detection prerequisite, and its absence never yields
    /// NO_DEVICE).
    fn assert_usb_invariants(state: &DeviceState) {
        assert_eq!(state.usb_observation_state, "USB_PRESENT");
        assert_eq!(state.usb_state, "USB_CONNECTED");
    }

    /// FSB-003 hardware validation — ADB-OFF leg of the runtime matrix.
    ///
    /// Requires the acceptance Samsung A10s physically connected with
    /// USB debugging disabled, plus `:host:installDist` built.
    ///
    /// Expected outcome: native USB truth reaches the Host through the
    /// GET_DEVICE_STATE payload and evaluates to USB_DETECTED with no ADB
    /// enrichment. The ADB-derived path must never produce NO_DEVICE here.
    ///
    /// Environment-aware: if an authorized ADB device is attached, this leg
    /// reports SKIP and returns (USB debugging is intentionally enabled in
    /// that environment) while the ADB-ON leg owns the expectations.
    #[test]
    #[ignore = "requires the connected Samsung A10s with USB debugging disabled"]
    fn device_state_with_adb_disabled_reports_usb_detected() {
        if authorized_adb_device_present() {
            println!(
                "VALIDATION=ADB_OFF skipped: environment not present \
                 (authorized ADB device attached; USB debugging enabled)"
            );
            return;
        }
        println!("VALIDATION=ADB_OFF: running (no authorized ADB device attached)");

        let (usb_connected, mut manager) = fsb003_usb_prelude();
        let state = query_device_state(&mut manager, usb_connected);

        assert_usb_invariants(&state);
        assert_eq!(state.connection_state, "USB_DETECTED");
        assert!(!state.adb_available);
        assert!(!state.ready_to_scan);
    }

    /// FSB-003 hardware validation — ADB-ON leg of the runtime matrix.
    ///
    /// Requires the acceptance Samsung A10s physically connected with
    /// USB debugging enabled and RSA-authorized, plus `:host:installDist`
    /// built.
    ///
    /// Expected outcome: the USB truth is unchanged (USB_PRESENT /
    /// USB_CONNECTED) while the connection state is enriched to ADB_READY —
    /// ADB contributes bench evidence only, never the USB detection itself.
    ///
    /// Environment-aware: if no authorized ADB device is attached, this leg
    /// reports SKIP and returns while the ADB-OFF leg owns that environment.
    #[test]
    #[ignore = "requires the connected Samsung A10s with USB debugging enabled and authorized"]
    fn device_state_with_adb_enabled_reports_adb_ready() {
        if !authorized_adb_device_present() {
            println!(
                "VALIDATION=ADB_ON skipped: environment not present \
                 (no authorized ADB device attached; USB debugging disabled)"
            );
            return;
        }
        println!("VALIDATION=ADB_ON: running (authorized ADB device attached)");

        let (usb_connected, mut manager) = fsb003_usb_prelude();
        let state = query_device_state(&mut manager, usb_connected);

        assert_usb_invariants(&state);
        assert_eq!(state.connection_state, "ADB_READY");
        assert!(state.adb_available);
        assert!(state.ready_to_scan);
    }
}

/// Wire-format guarantees for the generic JSON-lines bridge (P5).
///
/// These assert the bytes the Kotlin Host will actually read, so the bridge can
/// be proven correct without booting a JVM.
#[cfg(test)]
mod host_command_bridge_tests {
    use super::{
        build_host_request, validate_command_name, validate_response_envelope, PROTOCOL_VERSION,
    };
    use serde_json::{json, Value};

    /// Every command the Kotlin `HostCommand` enum exposes must pass the local
    /// shape check, otherwise the bridge would refuse a perfectly legal call.
    #[test]
    fn all_thirteen_host_commands_pass_the_shape_check() {
        let commands = [
            "GET_HOST_INFO",
            "GET_PREFLIGHT",
            "GET_DEVICE_STATE",
            "RUN_SCAN",
            "GET_DEVICE_REPORT",
            "GET_APPLICATION_INVENTORY",
            "EXPORT_REPORT",
            "SANITIZE_START",
            "SANITIZE_AUTHORIZE",
            "SANITIZE_CONFIRM",
            "SANITIZE_EXECUTE",
            "SANITIZE_VERIFY",
            "GET_FINAL_REPORT",
        ];

        assert_eq!(commands.len(), 13, "HostCommand changed; update this list");

        for command in commands {
            assert!(
                validate_command_name(command).is_ok(),
                "{command} must be accepted by the bridge"
            );
        }
    }

    /// A malformed name is refused here rather than written to the Host's
    /// stdin, where it would surface as a much less useful decode failure.
    #[test]
    fn malformed_command_names_are_refused_before_reaching_the_host() {
        let refused = [
            "",
            "run_scan",
            "RUN SCAN",
            "RUN-SCAN",
            "RUN_SCAN\n",
            " RUN_SCAN",
            "SANITIZE_START; DROP",
        ];

        for command in refused {
            assert!(
                validate_command_name(command).is_err(),
                "{command:?} must be refused"
            );
        }
    }

    #[test]
    fn request_envelope_carries_every_field_the_host_requires() {
        let (request_id, request) =
            build_host_request("SANITIZE_START", "{}").expect("valid request");

        assert_eq!(request.protocol_version, PROTOCOL_VERSION);
        assert_eq!(request.request_id, request_id);
        assert_eq!(request.command, "SANITIZE_START");
        assert_eq!(request.payload, json!({}));
    }

    /// The Host reads one command per line, so an encoded request must never
    /// contain a line break of its own.
    #[test]
    fn request_serializes_to_exactly_one_json_line() {
        let (_, request) = build_host_request(
            "RUN_SCAN",
            r#"{"serial":"RF8R123456","operatorId":"operator@cyvoriq.com"}"#,
        )
        .expect("valid request");

        let encoded = serde_json::to_string(&request).expect("encode");

        assert!(
            !encoded.contains('\n'),
            "encoded request spans lines: {encoded}"
        );
        assert!(
            !encoded.contains('\r'),
            "encoded request contains a carriage return: {encoded}"
        );

        let decoded: Value = serde_json::from_str(&encoded).expect("round trip");

        assert_eq!(decoded["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(decoded["command"], "RUN_SCAN");
        assert_eq!(decoded["payload"]["serial"], "RF8R123456");
        assert!(
            decoded["requestId"].as_str().is_some(),
            "requestId must be present: {decoded}"
        );
    }

    #[test]
    fn payload_must_be_a_json_object() {
        for payload in ["[]", "42", "\"RUN_SCAN\"", "null", "{not json", ""] {
            let error = build_host_request("RUN_SCAN", payload)
                .expect_err(&format!("{payload:?} must be refused"));

            assert!(
                error.starts_with("HOST_PAYLOAD_INVALID"),
                "unexpected error for {payload:?}: {error}"
            );
        }

        assert!(build_host_request("RUN_SCAN", r#"{"serial":"RF8R123456"}"#).is_ok());
        assert!(build_host_request("SANITIZE_CONFIRM", "{}").is_ok());
    }

    #[test]
    fn each_call_mints_a_distinct_request_id() {
        let (first, _) = build_host_request("GET_HOST_INFO", "{}").expect("first");
        let (second, _) = build_host_request("GET_HOST_INFO", "{}").expect("second");

        assert_ne!(first, second, "request ids must never repeat");
    }

    /// The bridge must not drop, rename or default any field the UI sent: the
    /// payload is the operator's input and travels through verbatim.
    #[test]
    fn payload_fields_survive_the_bridge_untouched() {
        let payload = r#"{
            "acknowledged": true,
            "confirmationPhrase": "CONFIRM PURGE PURGE-OP-1EE0D6AF",
            "nested": {"note": "filtered is not complete"}
        }"#;

        let (_, request) =
            build_host_request("SANITIZE_CONFIRM", payload).expect("valid");

        let expected: Value = serde_json::from_str(payload).expect("parse fixture");

        assert_eq!(request.payload, expected);
    }

    /// Fixture builder: parse a Host response line the same way the bridge does.
    fn response(line: &str) -> super::HostResponse {
        serde_json::from_str(line).unwrap_or_else(|error| panic!("bad fixture: {error}"))
    }

    #[test]
    fn envelope_check_accepts_an_answer_that_echoes_the_request() {
        let ok = response(
            r#"{"protocolVersion":"1","requestId":"d2.1-7","status":"OK","hostVersion":"0.0.0","payload":{},"error":null}"#,
        );

        assert!(validate_response_envelope(&ok, "d2.1-7").is_ok());
    }

    /// A refusal is still a valid answer as long as it is correlated.
    #[test]
    fn envelope_check_accepts_a_correlated_refusal() {
        let refused = response(
            r#"{"protocolVersion":"1","requestId":"d2.1-7","status":"ERROR","hostVersion":"0.0.0","payload":{},"error":{"code":"LICENSE_REQUIRED","message":"no licence"}}"#,
        );

        assert!(validate_response_envelope(&refused, "d2.1-7").is_ok());
    }

    /// A pipe that has drifted must not be mistaken for an answer.
    #[test]
    fn envelope_check_rejects_an_answer_for_a_different_request() {
        let stale = response(
            r#"{"protocolVersion":"1","requestId":"d2.1-6","status":"OK","hostVersion":"0.0.0","payload":{},"error":null}"#,
        );

        let error =
            validate_response_envelope(&stale, "d2.1-7").expect_err("mismatch must be caught");

        assert!(error.starts_with("HOST_REQUEST_ID_MISMATCH"), "{error}");
    }

    /// The Host answers `"unknown"` when it could not decode the request, and it
    /// could not have seen an id to echo. Treating that as a bridge failure
    /// would hide a readable `INVALID_REQUEST` behind a transport error.
    #[test]
    fn envelope_check_lets_invalid_request_through_so_the_refusal_is_visible() {
        let undecodable = response(
            r#"{"protocolVersion":"1","requestId":"unknown","status":"ERROR","hostVersion":"0.0.0","payload":{},"error":{"code":"INVALID_REQUEST","message":"Request is not valid Host Protocol V1 JSON"}}"#,
        );

        assert!(
            validate_response_envelope(&undecodable, "d2.1-7").is_ok(),
            "INVALID_REQUEST must reach the caller intact"
        );
    }

    /// The exception is narrow: only `INVALID_REQUEST` may skip the echo check.
    #[test]
    fn envelope_check_still_catches_an_uncorrelated_non_invalid_request_error() {
        let wrong_id = response(
            r#"{"protocolVersion":"1","requestId":"unknown","status":"ERROR","hostVersion":"0.0.0","payload":{},"error":{"code":"SCAN_REFUSED","message":"refused"}}"#,
        );

        let error = validate_response_envelope(&wrong_id, "d2.1-7")
            .expect_err("a non-INVALID_REQUEST answer must still be correlated");

        assert!(error.starts_with("HOST_REQUEST_ID_MISMATCH"), "{error}");
    }

    #[test]
    fn envelope_check_rejects_a_protocol_or_host_version_breach() {
        let wrong_protocol = response(
            r#"{"protocolVersion":"2","requestId":"d2.1-7","status":"OK","hostVersion":"0.0.0","payload":{},"error":null}"#,
        );
        let error = validate_response_envelope(&wrong_protocol, "d2.1-7")
            .expect_err("wrong protocol version");
        assert!(error.starts_with("HOST_PROTOCOL_MISMATCH"), "{error}");

        let blank_version = response(
            r#"{"protocolVersion":"1","requestId":"d2.1-7","status":"OK","hostVersion":"  ","payload":{},"error":null}"#,
        );
        let error =
            validate_response_envelope(&blank_version, "d2.1-7").expect_err("blank hostVersion");
        assert!(error.starts_with("HOST_INVALID_RESPONSE"), "{error}");
    }
}

/// Drives the generic bridge against the real Kotlin Host (P5).
///
/// Everything above asserts the bytes we *would* send. This boots the actual
/// Host, so the envelope shape, the single-line discipline and the
/// "`status: ERROR` is still `Ok`" contract are all verified against
/// production code rather than against a fixture.
#[cfg(all(test, debug_assertions))]
mod generic_bridge_end_to_end_tests {
    use super::{locate_host, HostProcessManager};
    use serde_json::Value;

    /// Boots the Host when one is available; outside CI it steps aside rather
    /// than failing for a reason unrelated to its subject (a fresh checkout
    /// legitimately has no staged payload and no `:host:installDist` output).
    fn host_available(test_name: &str) -> bool {
        match locate_host() {
            Ok(_) => true,
            Err(error) if std::env::var_os("CI").is_some() => {
                panic!("{test_name}: CI must stage a Host distribution first: {error}")
            }
            Err(error) => {
                eprintln!("SKIP {test_name}: {error}");
                false
            }
        }
    }

    fn parse(line: &str) -> Value {
        serde_json::from_str(line)
            .unwrap_or_else(|error| panic!("response must be one JSON line ({error}): {line}"))
    }

    #[test]
    fn generic_bridge_round_trips_against_the_real_host() {
        const TEST: &str = "generic_bridge_round_trips_against_the_real_host";

        if !host_available(TEST) {
            return;
        }

        let mut manager = HostProcessManager::new();

        // --- A well-formed request round-trips with a valid envelope -----
        let info_line = manager
            .send_host_command("GET_HOST_INFO", "{}")
            .expect("GET_HOST_INFO must round-trip");

        let info = parse(&info_line);

        assert_eq!(info["status"], "OK", "unexpected status: {info_line}");
        assert_eq!(info["protocolVersion"], "1", "wrong protocol: {info_line}");
        assert!(
            !info["requestId"].as_str().unwrap_or_default().is_empty(),
            "envelope must echo a requestId: {info_line}"
        );
        assert!(
            !info["hostVersion"].as_str().unwrap_or_default().is_empty(),
            "envelope must carry a hostVersion: {info_line}"
        );

        // --- A non-empty payload comes back intact -----------------------
        let preflight_line = manager
            .send_host_command("GET_PREFLIGHT", "{}")
            .expect("GET_PREFLIGHT must round-trip");

        let preflight = parse(&preflight_line);

        assert_eq!(preflight["status"], "OK", "unexpected status: {preflight_line}");
        assert!(
            preflight["payload"]["readyToScan"].is_boolean(),
            "preflight payload lost readyToScan: {preflight_line}"
        );
        assert!(
            preflight["payload"]["checks"].is_array(),
            "preflight payload lost its checks: {preflight_line}"
        );

        // --- A Host refusal is returned as `Ok`, not swallowed as `Err` ----
        //
        // This is the whole reason `send_host_command` does not reuse
        // `validate_envelope`: the UI has to show WHY the Host refused.
        let refused_line = manager
            .send_host_command("RUN_SCAN", "{}")
            .expect("an ERROR status is a completed round-trip, not a bridge failure");

        let refused = parse(&refused_line);

        assert_eq!(refused["status"], "ERROR", "expected a refusal: {refused_line}");
        assert!(
            !refused["error"]["code"].as_str().unwrap_or_default().is_empty(),
            "refusal must carry a structured error code: {refused_line}"
        );
        assert!(
            !refused["error"]["message"].as_str().unwrap_or_default().is_empty(),
            "refusal must carry a message the operator can read: {refused_line}"
        );
        assert!(
            refused["requestId"].as_str().is_some(),
            "a refusal is still a correlated envelope: {refused_line}"
        );

        // --- Local validation never reaches the Host ---------------------
        for bad in [
            ("run_scan", "{}"),
            ("RUN SCAN", "{}"),
            ("RUN_SCAN", "[]"),
            ("RUN_SCAN", "{oops"),
        ] {
            assert!(
                manager.send_host_command(bad.0, bad.1).is_err(),
                "{bad:?} must be refused locally"
            );
        }

        // --- The pipe survives every rejected attempt --------------------
        let again = manager
            .send_host_command("GET_HOST_INFO", "{}")
            .expect("bridge must stay healthy after refused requests");

        assert_eq!(parse(&again)["status"], "OK", "pipe corrupted: {again}");
    }
}
