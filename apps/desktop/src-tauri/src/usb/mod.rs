pub(crate) mod enumerate;
pub(crate) mod model;
pub(crate) mod notification;

use notification::UsbNotificationRegistration;
use windows::Win32::Devices::DeviceAndDriverInstallation::CONFIGRET;

// Compile-time anchors only.
//
// B3A-3C intentionally does NOT start runtime USB observation.
const _: fn() -> Result<UsbNotificationRegistration, CONFIGRET> =
    UsbNotificationRegistration::register;

const _: fn() -> model::UsbObservation = enumerate::enumerate_usb_devices;
