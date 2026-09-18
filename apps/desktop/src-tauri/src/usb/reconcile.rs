use std::collections::BTreeMap;

use serde::Serialize;

use super::model::{UsbObservation, UsbObservationState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum UsbTopologyEventType {
    UsbDeviceArrived,
    UsbDeviceRemoved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsbTopologyEvent {
    pub(crate) event_type: UsbTopologyEventType,
    pub(crate) device_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UsbReconciliation {
    pub(crate) observation: UsbObservation,
    pub(crate) events: Vec<UsbTopologyEvent>,
}

/// Derives topology events exclusively by comparing two authoritative
/// SetupAPI snapshots.
///
/// Frozen B3A invariant:
///
/// Notification is only the trigger.
/// Enumeration is the truth.
///
/// Therefore this reconciler never accepts "arrival" or "removal" as input.
pub(crate) struct UsbSnapshotReconciler {
    previous: UsbObservation,
}

impl UsbSnapshotReconciler {
    pub(crate) fn new(initial: UsbObservation) -> Self {
        Self { previous: initial }
    }

    pub(crate) fn reconcile(&mut self, current: UsbObservation) -> UsbReconciliation {
        // UNKNOWN is not evidence that anything was removed.
        //
        // Preserve the last authoritative snapshot and emit no event.
        if current.observation_state == UsbObservationState::UsbObservationUnknown {
            return UsbReconciliation {
                observation: current,
                events: Vec::new(),
            };
        }

        // If the previous state was UNKNOWN, the first successful snapshot
        // establishes a new baseline. We cannot safely infer transitions that
        // occurred while observation was unavailable.
        if self.previous.observation_state == UsbObservationState::UsbObservationUnknown {
            self.previous = current.clone();

            return UsbReconciliation {
                observation: current,
                events: Vec::new(),
            };
        }

        let previous_paths = normalized_paths(&self.previous);

        let current_paths = normalized_paths(&current);

        let mut events = Vec::new();

        // ARRIVED means:
        //
        // present in the new authoritative snapshot,
        // absent from the previous authoritative snapshot.
        for (key, path) in &current_paths {
            if !previous_paths.contains_key(key) {
                events.push(UsbTopologyEvent {
                    event_type: UsbTopologyEventType::UsbDeviceArrived,
                    device_path: path.clone(),
                });
            }
        }

        // REMOVED means:
        //
        // present in the previous authoritative snapshot,
        // absent from the new authoritative snapshot.
        for (key, path) in &previous_paths {
            if !current_paths.contains_key(key) {
                events.push(UsbTopologyEvent {
                    event_type: UsbTopologyEventType::UsbDeviceRemoved,
                    device_path: path.clone(),
                });
            }
        }

        self.previous = current.clone();

        UsbReconciliation {
            observation: current,
            events,
        }
    }
}

fn normalized_paths(observation: &UsbObservation) -> BTreeMap<String, String> {
    observation
        .devices
        .iter()
        .map(|device| {
            (
                device.device_path.to_ascii_lowercase(),
                device.device_path.clone(),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::usb::model::{UsbConnectionState, UsbDeviceObservation};

    fn snapshot(paths: &[&str]) -> UsbObservation {
        let devices = paths
            .iter()
            .map(|path| UsbDeviceObservation {
                device_path: (*path).to_string(),
                connection_state: UsbConnectionState::Present,
            })
            .collect::<Vec<_>>();

        UsbObservation {
            observation_state: if devices.is_empty() {
                UsbObservationState::UsbNotPresent
            } else {
                UsbObservationState::UsbPresent
            },

            devices,

            observed_at: "test-time".to_string(),

            source: "test".to_string(),
        }
    }

    #[test]
    fn unchanged_snapshot_emits_no_event() {
        let mut reconciler = UsbSnapshotReconciler::new(snapshot(&["USB#ONE"]));

        let result = reconciler.reconcile(snapshot(&["USB#ONE"]));

        assert!(result.events.is_empty());
    }

    #[test]
    fn newly_present_path_is_arrived() {
        let mut reconciler = UsbSnapshotReconciler::new(snapshot(&[]));

        let result = reconciler.reconcile(snapshot(&["USB#ONE"]));

        assert_eq!(result.events.len(), 1);

        assert_eq!(
            result.events[0].event_type,
            UsbTopologyEventType::UsbDeviceArrived
        );

        assert_eq!(result.events[0].device_path, "USB#ONE");
    }

    #[test]
    fn missing_previous_path_is_removed() {
        let mut reconciler = UsbSnapshotReconciler::new(snapshot(&["USB#ONE"]));

        let result = reconciler.reconcile(snapshot(&[]));

        assert_eq!(result.events.len(), 1);

        assert_eq!(
            result.events[0].event_type,
            UsbTopologyEventType::UsbDeviceRemoved
        );

        assert_eq!(result.events[0].device_path, "USB#ONE");
    }

    #[test]
    fn path_comparison_is_case_insensitive() {
        let mut reconciler = UsbSnapshotReconciler::new(snapshot(&["USB#ONE"]));

        let result = reconciler.reconcile(snapshot(&["usb#one"]));

        assert!(result.events.is_empty());
    }

    #[test]
    fn unknown_snapshot_never_creates_false_removal() {
        let mut reconciler = UsbSnapshotReconciler::new(snapshot(&["USB#ONE"]));

        let unknown = UsbObservation::unknown("temporary failure");

        let unknown_result = reconciler.reconcile(unknown);

        assert!(unknown_result.events.is_empty());

        // Previous authoritative state must still be retained.
        let recovered = reconciler.reconcile(snapshot(&[]));

        assert_eq!(recovered.events.len(), 1);

        assert_eq!(
            recovered.events[0].event_type,
            UsbTopologyEventType::UsbDeviceRemoved
        );
    }

    #[test]
    fn recovery_from_unknown_establishes_baseline_without_event() {
        let mut reconciler =
            UsbSnapshotReconciler::new(UsbObservation::unknown("initial enumeration unavailable"));

        let result = reconciler.reconcile(snapshot(&["USB#ONE"]));

        assert!(result.events.is_empty());

        let unchanged = reconciler.reconcile(snapshot(&["USB#ONE"]));

        assert!(unchanged.events.is_empty());
    }
}
