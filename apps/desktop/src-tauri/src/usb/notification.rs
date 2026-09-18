use std::{ffi::c_void, mem::size_of, ptr::null_mut};

use windows::Win32::Devices::{
    DeviceAndDriverInstallation::{
        CM_Register_Notification, CM_Unregister_Notification, CM_NOTIFY_ACTION,
        CM_NOTIFY_EVENT_DATA, CM_NOTIFY_FILTER, CM_NOTIFY_FILTER_0, CM_NOTIFY_FILTER_0_0,
        CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE, CONFIGRET, CR_SUCCESS, HCMNOTIFICATION,
    },
    Usb::GUID_DEVINTERFACE_USB_DEVICE,
};

/// Owns one Configuration Manager USB device-interface notification
/// registration.
///
/// B3A-1B deliberately carries no callback context and performs no USB
/// enumeration. Context ownership and topology reconciliation belong to
/// later B3A gates.
pub(crate) struct UsbNotificationRegistration {
    handle: Option<HCMNOTIFICATION>,
}

impl UsbNotificationRegistration {
    /// Register for USB device-interface topology notifications.
    ///
    /// The callback is deliberately minimal at this gate. It neither
    /// interprets the notification as authoritative device state nor performs
    /// any blocking work.
    pub(crate) fn register() -> Result<Self, CONFIGRET> {
        let mut filter = CM_NOTIFY_FILTER::default();

        filter.cbSize = size_of::<CM_NOTIFY_FILTER>() as u32;
        filter.FilterType = CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE;
        filter.u = CM_NOTIFY_FILTER_0 {
            DeviceInterface: CM_NOTIFY_FILTER_0_0 {
                ClassGuid: GUID_DEVINTERFACE_USB_DEVICE,
            },
        };

        let mut handle = HCMNOTIFICATION(null_mut());

        let result = unsafe {
            CM_Register_Notification(&filter, None, Some(notification_callback), &mut handle)
        };

        if result != CR_SUCCESS {
            return Err(result);
        }

        debug_assert!(
            !handle.is_invalid(),
            "CM_Register_Notification returned CR_SUCCESS with an invalid handle"
        );

        Ok(Self {
            handle: Some(handle),
        })
    }
}

impl Drop for UsbNotificationRegistration {
    fn drop(&mut self) {
        let Some(handle) = self.handle.take() else {
            return;
        };

        let result = unsafe { CM_Unregister_Notification(handle) };

        if result != CR_SUCCESS {
            log::warn!("USB notification unregister failed: {:?}", result);
        }
    }
}

/// Configuration Manager callback.
///
/// Frozen B3A rule:
///
/// Notification is only a topology-change trigger.
/// Enumeration will become the authoritative source of truth in B3A-3.
///
/// B3A-1B therefore performs no enumeration, allocation, logging,
/// synchronization, ADB access, Host communication, or Tauri emission here.
unsafe extern "system" fn notification_callback(
    _notification: HCMNOTIFICATION,
    _context: *const c_void,
    _action: CM_NOTIFY_ACTION,
    _event_data: *const CM_NOTIFY_EVENT_DATA,
    _event_data_size: u32,
) -> u32 {
    0
}
