use std::{
    error::Error,
    fmt,
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender},
        Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use super::{
    model::UsbObservationState,
    observer::UsbObserver,
    reconcile::{UsbReconciliation, UsbTopologyEventType},
};

const RUNTIME_POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Debug)]
pub(crate) enum UsbRuntimeStartError {
    WorkerSpawn(std::io::Error),
    Registration(u32),
    BootstrapDisconnected,
}

impl fmt::Display for UsbRuntimeStartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WorkerSpawn(error) => {
                write!(formatter, "could not start CYVRA USB worker: {error}")
            }

            Self::Registration(code) => {
                write!(
                    formatter,
                    "Windows USB notification registration failed: CONFIGRET({code})"
                )
            }

            Self::BootstrapDisconnected => {
                write!(
                    formatter,
                    "CYVRA USB worker ended before bootstrap completed"
                )
            }
        }
    }
}

impl Error for UsbRuntimeStartError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::WorkerSpawn(error) => Some(error),
            Self::Registration(_) | Self::BootstrapDisconnected => None,
        }
    }
}

struct RuntimeState {
    stop_tx: Option<Sender<()>>,
    worker: Option<JoinHandle<()>>,
}

/// Owns the lifetime of the native Windows USB observer worker.
///
/// The worker itself creates and owns `UsbObserver`. This is deliberate:
/// the Windows notification registration is created, used and destroyed
/// on the same dedicated worker thread.
///
/// Tauri owns only this runtime controller.
pub(crate) struct UsbRuntime {
    state: Mutex<RuntimeState>,
}

impl UsbRuntime {
    pub(crate) fn start() -> Result<Self, UsbRuntimeStartError> {
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), u32>>(1);

        let (stop_tx, stop_rx) = mpsc::channel::<()>();

        let worker = thread::Builder::new()
            .name("cyvra-usb-observer".to_string())
            .spawn(move || {
                worker_main(ready_tx, stop_rx);
            })
            .map_err(UsbRuntimeStartError::WorkerSpawn)?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self {
                state: Mutex::new(RuntimeState {
                    stop_tx: Some(stop_tx),
                    worker: Some(worker),
                }),
            }),

            Ok(Err(code)) => {
                let _ = worker.join();

                Err(UsbRuntimeStartError::Registration(code))
            }

            Err(_) => {
                let _ = worker.join();

                Err(UsbRuntimeStartError::BootstrapDisconnected)
            }
        }
    }

    /// Deterministic and idempotent shutdown.
    ///
    /// Sending on the stop channel wakes the worker immediately rather
    /// than waiting for the next poll interval.
    ///
    /// Joining guarantees that `UsbObserver` is dropped before this
    /// function returns. Its notification-registration Drop path then
    /// unregisters the Windows callback while its context is still valid.
    pub(crate) fn shutdown(&self) {
        let (stop_tx, worker) = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());

            (state.stop_tx.take(), state.worker.take())
        };

        let Some(worker) = worker else {
            return;
        };

        if let Some(stop_tx) = stop_tx {
            if stop_tx.send(()).is_err() {
                log::warn!("CYVRA_USB STOP_CHANNEL_DISCONNECTED");
            }
        }

        match worker.join() {
            Ok(()) => {
                log::info!("CYVRA_USB RUNTIME_JOINED");
            }

            Err(_) => {
                log::error!("CYVRA_USB WORKER_PANICKED");
            }
        }
    }
}

impl Drop for UsbRuntime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn worker_main(ready_tx: SyncSender<Result<(), u32>>, stop_rx: Receiver<()>) {
    let mut observer = match UsbObserver::register() {
        Ok(observer) => observer,

        Err(error) => {
            let _ = ready_tx.send(Err(error.0));

            return;
        }
    };

    if ready_tx.send(Ok(())).is_err() {
        return;
    }

    log::info!("CYVRA_USB RUNTIME_STARTED");

    loop {
        match stop_rx.recv_timeout(RUNTIME_POLL_INTERVAL) {
            Ok(()) => break,

            Err(RecvTimeoutError::Disconnected) => {
                break;
            }

            Err(RecvTimeoutError::Timeout) => {}
        }

        if let Some(reconciliation) = observer.poll(Instant::now()) {
            log_reconciliation(&reconciliation);
        }
    }

    log::info!("CYVRA_USB RUNTIME_STOPPING");

    // `observer` intentionally drops here, on the worker thread.
    //
    // That drop owns the native notification-registration shutdown.
}

fn log_reconciliation(reconciliation: &UsbReconciliation) {
    if reconciliation.observation.observation_state == UsbObservationState::UsbObservationUnknown {
        log::warn!(
            "CYVRA_USB OBSERVATION_UNKNOWN source={}",
            reconciliation.observation.source
        );
    }

    for event in &reconciliation.events {
        match event.event_type {
            UsbTopologyEventType::UsbDeviceArrived => {
                log::info!("CYVRA_USB ARRIVED path={}", event.device_path);
            }

            UsbTopologyEventType::UsbDeviceRemoved => {
                log::info!("CYVRA_USB REMOVED path={}", event.device_path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_without_worker_is_idempotent() {
        let runtime = UsbRuntime {
            state: Mutex::new(RuntimeState {
                stop_tx: None,
                worker: None,
            }),
        };

        runtime.shutdown();
        runtime.shutdown();

        let state = runtime
            .state
            .lock()
            .expect("runtime state should not be poisoned");

        assert!(state.worker.is_none());

        assert!(state.stop_tx.is_none());
    }

    #[test]
    fn registration_error_is_descriptive() {
        let error = UsbRuntimeStartError::Registration(123);

        assert!(error.to_string().contains("CONFIGRET(123)"));
    }
}
