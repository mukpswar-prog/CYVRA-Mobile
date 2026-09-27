use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[allow(clippy::enum_variant_names)]
pub(crate) enum UsbObservationState {
    UsbPresent,
    UsbNotPresent,
    UsbObservationUnknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum UsbConnectionState {
    Present,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsbDeviceObservation {
    pub(crate) device_path: String,
    pub(crate) connection_state: UsbConnectionState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsbObservation {
    pub(crate) observation_state: UsbObservationState,
    pub(crate) devices: Vec<UsbDeviceObservation>,
    pub(crate) observed_at: String,
    pub(crate) source: String,
}

impl UsbObservation {
    pub(crate) fn unknown(source: impl Into<String>) -> Self {
        Self {
            observation_state: UsbObservationState::UsbObservationUnknown,
            devices: Vec::new(),
            observed_at: observation_time(),
            source: source.into(),
        }
    }
}

pub(crate) fn observation_time() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis().to_string(),
        Err(_) => "0".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_observation_contains_no_devices() {
        let observation = UsbObservation::unknown("test");

        assert_eq!(
            observation.observation_state,
            UsbObservationState::UsbObservationUnknown
        );
        assert!(observation.devices.is_empty());
        assert!(!observation.observed_at.is_empty());
        assert_eq!(observation.source, "test");
    }
}
