pub(crate) mod enumerate;
pub(crate) mod model;
pub(crate) mod notification;
pub(crate) mod observer;
pub(crate) mod reconcile;
pub(crate) mod runtime;

use windows::Win32::Devices::DeviceAndDriverInstallation::CONFIGRET;

use notification::UsbNotificationRegistration;

// Compile-time anchors only.
//
// Nothing in B3A-3D starts USB observation from Tauri.
const _: fn() -> Result<UsbNotificationRegistration, CONFIGRET> =
    UsbNotificationRegistration::register;

const _: fn() -> model::UsbObservation = enumerate::enumerate_usb_devices;

const _: fn() -> Result<observer::UsbObserver, CONFIGRET> = observer::UsbObserver::register;
