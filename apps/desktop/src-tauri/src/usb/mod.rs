pub(crate) mod notification;

use notification::UsbNotificationRegistration;
use windows::Win32::Devices::DeviceAndDriverInstallation::CONFIGRET;

// Compile-time anchor only.
//
// B3A-1B intentionally does not start USB observation at runtime.
// Referencing the constructor here keeps the isolated registration
// boundary type-checked without wiring it into Tauri or application state.
const _: fn() -> Result<UsbNotificationRegistration, CONFIGRET> =
    UsbNotificationRegistration::register;
