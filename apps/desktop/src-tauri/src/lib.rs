#[cfg(windows)]
mod usb;

#[cfg(windows)]
mod wpd;

mod commands;
mod host_process;

#[cfg(windows)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(commands::HostState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_host_info,
            commands::get_wpd_devices
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