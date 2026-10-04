#[cfg(windows)]
mod usb;

#[cfg(windows)]
mod wpd;

mod activation;
mod commands;
mod host_process;
mod ledger;

/// Console entry point used by the packaging gate and the installer preflight.
///
/// Boots the bundled Host and performs one protocol round-trip without opening
/// a window, so CI can prove an *installed* layout is complete before an
/// artifact is published.
pub fn host_selftest() -> Result<String, String> {
    host_process::run_selftest()
}

#[cfg(windows)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Resolve the licence transport once, here, before Tauri builds anything.
    //
    // Two reasons this is the right place rather than inside a command:
    //
    // * `live_client::production_client` caches its answer in a `OnceLock`, so
    //   the first resolution decides the mode for the process's whole life -
    //   building it early means a misconfigured endpoint fails at startup
    //   rather than on the operator's first attempt.
    // * The live client owns a blocking HTTP client. Constructing one is only
    //   unambiguously safe on a thread that is not inside an async runtime, and
    //   this is the main thread before the runtime exists.
    //
    // With `CYVRA_ACTIVATION_BASE_URL` unset - the shipped state - this resolves
    // to the live client on `DEFAULT_BASE_URL`, so a broken endpoint is still
    // decided here, at startup, rather than on the operator's first attempt.
    let _licence_transport = activation::live_client::production_client();

    let app = tauri::Builder::default()
        .manage(commands::HostState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_host_info,
            commands::get_device_state,
            commands::get_wpd_devices,
            commands::scan_wpd_device_metadata,
            commands::send_host_command,
            activation::commands::activation_launch,
            activation::commands::activation_submit,
            commands::ledger_read
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(windows)]
            {
                let usb_runtime =
                    usb::runtime::UsbRuntime::start()?;

                if !app.manage(usb_runtime) {
                    return Err(
                        std::io::Error::other(
                            "CYVRA USB runtime state was already managed",
                        )
                        .into(),
                    );
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building CYVRA Mobile");

    app.run(|app_handle, event| {
        #[cfg(windows)]
        {
            if matches!(
                event,
                tauri::RunEvent::Exit
            ) {
                if let Some(runtime) =
                    app_handle
                        .try_state::<
                            usb::runtime::UsbRuntime
                        >()
                {
                    runtime.shutdown();
                }
            }
        }

        #[cfg(not(windows))]
        {
            let _ = (app_handle, event);
        }
    });
}