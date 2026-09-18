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
    error: Option<HostError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub protocol_version: String,
    pub request_id: String,
    pub host_version: String,
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

        if response.protocol_version != PROTOCOL_VERSION {
            return Err(format!(
                "HOST_PROTOCOL_MISMATCH: expected protocol {}, received {}",
                PROTOCOL_VERSION, response.protocol_version
            ));
        }

        if response.request_id != request_id {
            return Err(format!(
                "HOST_REQUEST_ID_MISMATCH: expected {}, received {}",
                request_id, response.request_id
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

        Ok(HostInfo {
            protocol_version: response.protocol_version,
            request_id: response.request_id,
            host_version: response.host_version,
        })
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
