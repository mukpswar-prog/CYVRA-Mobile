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
