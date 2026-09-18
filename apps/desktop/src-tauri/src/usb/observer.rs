use std::time::{Duration, Instant};

use windows::Win32::Devices::DeviceAndDriverInstallation::CONFIGRET;

use super::{
    enumerate::enumerate_usb_devices,
    notification::UsbNotificationRegistration,
    reconcile::{UsbReconciliation, UsbSnapshotReconciler},
};

const TOPOLOGY_COALESCE_WINDOW: Duration = Duration::from_millis(75);

/// Small deterministic coalescing policy.
///
/// Repeated topology signals move the deadline forward.
/// No sleeping or blocking occurs here.
///
/// A future runtime worker may poll this policy and perform enumeration only
/// when the deadline becomes due.
struct TopologyCoalescer {
    deadline: Option<Instant>,
}

impl TopologyCoalescer {
    fn new() -> Self {
        Self { deadline: None }
    }

    fn signal(&mut self, now: Instant) {
        self.deadline = Some(now + TOPOLOGY_COALESCE_WINDOW);
    }

    fn take_due(&mut self, now: Instant) -> bool {
        let Some(deadline) = self.deadline else {
            return false;
        };

        if now < deadline {
            return false;
        }

        self.deadline = None;
        true
    }
}

/// Internal USB observation engine.
///
/// Registration intentionally happens BEFORE initial enumeration.
///
/// This ordering closes the startup race:
///
/// 1. register Windows notification callback;
/// 2. enumerate the initial authoritative snapshot;
/// 3. if topology changed during enumeration, the callback's atomic flag
///    remains set and the next poll schedules another enumeration.
///
/// This type is not yet wired into Tauri application startup.
pub(crate) struct UsbObserver {
    registration: UsbNotificationRegistration,
    coalescer: TopologyCoalescer,
    reconciler: UsbSnapshotReconciler,
}

impl UsbObserver {
    pub(crate) fn register() -> Result<Self, CONFIGRET> {
        // Registration MUST happen first.
        let registration = UsbNotificationRegistration::register()?;

        // Enumeration happens second.
        let initial = enumerate_usb_devices();

        Ok(Self {
            registration,

            coalescer: TopologyCoalescer::new(),

            reconciler: UsbSnapshotReconciler::new(initial),
        })
    }

    /// Poll the native topology trigger and reconcile only when the
    /// coalescing deadline becomes due.
    ///
    /// The caller controls polling frequency.
    ///
    /// B3A-3D deliberately does not create a background thread and does not
    /// wire this observer into Tauri. That runtime boundary is verified in
    /// the next gate.
    pub(crate) fn poll(&mut self, now: Instant) -> Option<UsbReconciliation> {
        if self.registration.take_topology_changed() {
            self.coalescer.signal(now);
        }

        if !self.coalescer.take_due(now) {
            return None;
        }

        Some(self.reconciler.reconcile(enumerate_usb_devices()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coalescer_waits_for_window() {
        let mut coalescer = TopologyCoalescer::new();

        let start = Instant::now();

        coalescer.signal(start);

        assert!(!coalescer.take_due(start + Duration::from_millis(74)));

        assert!(coalescer.take_due(start + Duration::from_millis(75)));
    }

    #[test]
    fn repeated_signal_extends_deadline() {
        let mut coalescer = TopologyCoalescer::new();

        let start = Instant::now();

        coalescer.signal(start);

        coalescer.signal(start + Duration::from_millis(50));

        assert!(!coalescer.take_due(start + Duration::from_millis(75)));

        assert!(!coalescer.take_due(start + Duration::from_millis(124)));

        assert!(coalescer.take_due(start + Duration::from_millis(125)));
    }

    #[test]
    fn due_signal_is_consumed_once() {
        let mut coalescer = TopologyCoalescer::new();

        let start = Instant::now();

        coalescer.signal(start);

        let due = start + TOPOLOGY_COALESCE_WINDOW;

        assert!(coalescer.take_due(due));
        assert!(!coalescer.take_due(due));
    }
}
