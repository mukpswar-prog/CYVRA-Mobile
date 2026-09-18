use std::{
    ffi::c_void,
    mem::size_of,
    ptr::null_mut,
    sync::atomic::{AtomicBool, Ordering},
};

use windows::Win32::Devices::{
    DeviceAndDriverInstallation::{
        CM_Register_Notification, CM_Unregister_Notification, CM_NOTIFY_ACTION,
        CM_NOTIFY_EVENT_DATA, CM_NOTIFY_FILTER, CM_NOTIFY_FILTER_0, CM_NOTIFY_FILTER_0_0,
        CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE, CONFIGRET, CR_SUCCESS, HCMNOTIFICATION,
    },
    Usb::GUID_DEVINTERFACE_USB_DEVICE,
};

/// Callback-owned state shared with the Windows Configuration Manager.
///
/// The allocation must remain alive from before CM_Register_Notification is
/// called until CM_Unregister_Notification has completed successfully.
///
/// The callback performs only one operation on this context: an atomic signal.
struct NotificationContext {
    topology_changed: AtomicBool,
}

impl NotificationContext {
    fn new() -> Self {
        Self {
            topology_changed: AtomicBool::new(false),
        }
    }

    fn signal_topology_changed(&self) {
        self.topology_changed.store(true, Ordering::Release);
    }

    fn take_topology_changed(&self) -> bool {
        self.topology_changed.swap(false, Ordering::AcqRel)
    }
}

/// Owns one Configuration Manager USB device-interface notification
/// registration and its callback context.
///
/// Safety invariant:
///
/// 1. `context` is allocated before registration.
/// 2. Windows receives only a pointer into that stable allocation.
/// 3. `context` remains alive while `handle` is registered.
/// 4. shutdown unregisters first.
/// 5. context is released only after unregister succeeds.
///
/// B3A-2 does not perform USB enumeration or runtime application wiring.
pub(crate) struct UsbNotificationRegistration {
    handle: Option<HCMNOTIFICATION>,
    context: Option<Box<NotificationContext>>,
}

impl UsbNotificationRegistration {
    /// Register for USB device-interface topology notifications.
    pub(crate) fn register() -> Result<Self, CONFIGRET> {
        let context = Box::new(NotificationContext::new());

        let context_ptr = (&*context as *const NotificationContext).cast::<c_void>();

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
            CM_Register_Notification(
                &filter,
                Some(context_ptr),
                Some(notification_callback),
                &mut handle,
            )
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
            context: Some(context),
        })
    }

    /// Shut down the native registration.
    ///
    /// This operation is idempotent.
    ///
    /// The context is deliberately retained until
    /// CM_Unregister_Notification succeeds because Windows may still be
    /// executing or dispatching callbacks before that call completes.
    pub(crate) fn shutdown(&mut self) -> Result<(), CONFIGRET> {
        let Some(handle) = self.handle else {
            self.context.take();
            return Ok(());
        };

        let result = unsafe { CM_Unregister_Notification(handle) };

        if result != CR_SUCCESS {
            return Err(result);
        }

        self.handle = None;

        // Safe only after CM_Unregister_Notification has completed.
        self.context.take();

        Ok(())
    }

    /// Future B3A-3 reconciliation code will consume this signal.
    ///
    /// The signal does NOT describe arrival/removal itself.
    /// It means only: "USB topology may have changed; enumerate again."
    #[allow(dead_code)]
    pub(crate) fn take_topology_changed(&self) -> bool {
        self.context
            .as_ref()
            .is_some_and(|context| context.take_topology_changed())
    }

    #[cfg(test)]
    fn without_native_registration_for_test() -> Self {
        Self {
            handle: None,
            context: Some(Box::new(NotificationContext::new())),
        }
    }
}

impl Drop for UsbNotificationRegistration {
    fn drop(&mut self) {
        if let Err(result) = self.shutdown() {
            log::error!(
                "USB notification unregister failed during drop: {:?}. \
                 Callback context will be intentionally retained to avoid \
                 a possible use-after-free.",
                result
            );

            // If unregister failed, Windows may still hold the callback
            // context pointer. Leaking this small allocation is safer than
            // freeing memory that a later callback could dereference.
            if let Some(context) = self.context.take() {
                Box::leak(context);
            }

            self.handle = None;
        }
    }
}

/// Configuration Manager callback.
///
/// Frozen B3A rule:
///
/// Notification is only the trigger. Enumeration is the truth.
///
/// Therefore this callback:
/// - performs no enumeration;
/// - performs no allocation;
/// - performs no logging;
/// - performs no blocking I/O;
/// - performs no ADB/Kotlin/Host work;
/// - emits no Tauri event.
///
/// It only atomically records that USB topology may have changed.
unsafe extern "system" fn notification_callback(
    _notification: HCMNOTIFICATION,
    context: *const c_void,
    _action: CM_NOTIFY_ACTION,
    _event_data: *const CM_NOTIFY_EVENT_DATA,
    _event_data_size: u32,
) -> u32 {
    if context.is_null() {
        return 0;
    }

    let context = unsafe { &*context.cast::<NotificationContext>() };

    context.signal_topology_changed();

    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn topology_signal_starts_clear() {
        let context = NotificationContext::new();

        assert!(!context.take_topology_changed());
    }

    #[test]
    fn topology_signal_can_be_consumed() {
        let context = NotificationContext::new();

        context.signal_topology_changed();

        assert!(context.take_topology_changed());
        assert!(!context.take_topology_changed());
    }

    #[test]
    fn repeated_topology_signals_coalesce() {
        let context = NotificationContext::new();

        context.signal_topology_changed();
        context.signal_topology_changed();
        context.signal_topology_changed();

        assert!(context.take_topology_changed());
        assert!(!context.take_topology_changed());
    }

    #[test]
    fn shutdown_without_native_handle_is_idempotent() {
        let mut registration = UsbNotificationRegistration::without_native_registration_for_test();

        assert!(registration.context.is_some());

        registration.shutdown().unwrap();

        assert!(registration.context.is_none());

        registration.shutdown().unwrap();

        assert!(registration.context.is_none());
    }
}
