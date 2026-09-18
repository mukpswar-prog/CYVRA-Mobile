use std::mem::size_of;

use windows::{
    core::{HRESULT, PCWSTR},
    Win32::{
        Devices::DeviceAndDriverInstallation::{
            SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo, SetupDiGetClassDevsW,
            SetupDiGetDeviceInstanceIdW, DIGCF_ALLCLASSES, DIGCF_PRESENT, HDEVINFO,
            SP_DEVINFO_DATA,
        },
        Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_NO_MORE_ITEMS},
    },
};

use super::model::{
    observation_time, UsbConnectionState, UsbDeviceObservation, UsbObservation, UsbObservationState,
};

const SOURCE: &str = "Windows SetupAPI present USB device-instance enumeration";

fn win32_hresult(code: u32) -> HRESULT {
    HRESULT::from_win32(code)
}

fn is_usb_instance_id(value: &str) -> bool {
    value
        .get(..4)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("USB\\"))
}

fn device_instance_id(
    device_info_set: HDEVINFO,
    device_info_data: &SP_DEVINFO_DATA,
) -> Result<String, String> {
    let mut required_size = 0u32;

    let size_result = unsafe {
        SetupDiGetDeviceInstanceIdW(
            device_info_set,
            device_info_data,
            None,
            Some(&mut required_size),
        )
    };

    match size_result {
        Err(error) if error.code() == win32_hresult(ERROR_INSUFFICIENT_BUFFER.0) => {}
        Err(error) => {
            return Err(format!("SETUPAPI_INSTANCE_ID_SIZE_FAILED:{error:?}"));
        }
        Ok(()) => {}
    }

    if required_size == 0 {
        return Err("SETUPAPI_INSTANCE_ID_SIZE_ZERO".to_string());
    }

    let buffer_len = usize::try_from(required_size)
        .map_err(|_| "SETUPAPI_INSTANCE_ID_SIZE_OVERFLOW".to_string())?;

    let mut buffer = vec![0u16; buffer_len];

    unsafe {
        SetupDiGetDeviceInstanceIdW(
            device_info_set,
            device_info_data,
            Some(buffer.as_mut_slice()),
            None,
        )
    }
    .map_err(|error| format!("SETUPAPI_INSTANCE_ID_READ_FAILED:{error:?}"))?;

    let nul_index = buffer
        .iter()
        .position(|unit| *unit == 0)
        .ok_or_else(|| "SETUPAPI_INSTANCE_ID_NOT_TERMINATED".to_string())?;

    if nul_index == 0 {
        return Err("SETUPAPI_INSTANCE_ID_EMPTY".to_string());
    }

    String::from_utf16(&buffer[..nul_index])
        .map_err(|error| format!("SETUPAPI_INSTANCE_ID_INVALID_UTF16:{error}"))
}

fn enumerate_from_device_info_set(device_info_set: HDEVINFO) -> UsbObservation {
    let mut devices = Vec::new();

    for index in 0u32.. {
        let mut device_info_data = SP_DEVINFO_DATA {
            cbSize: size_of::<SP_DEVINFO_DATA>() as u32,
            ..Default::default()
        };

        let result =
            unsafe { SetupDiEnumDeviceInfo(device_info_set, index, &mut device_info_data) };

        match result {
            Ok(()) => {}

            Err(error) if error.code() == win32_hresult(ERROR_NO_MORE_ITEMS.0) => {
                break;
            }

            Err(error) => {
                return UsbObservation::unknown(format!(
                    "{SOURCE} failed while enumerating index {index}: {error:?}"
                ));
            }
        }

        let instance_id = match device_instance_id(device_info_set, &device_info_data) {
            Ok(instance_id) => instance_id,

            Err(error) => {
                return UsbObservation::unknown(format!(
                    "{SOURCE} could not resolve device instance ID at index {index}: {error}"
                ));
            }
        };

        if !is_usb_instance_id(&instance_id) {
            continue;
        }

        devices.push(UsbDeviceObservation {
            // Existing B3A model field name is retained
            // deliberately to keep this correction isolated.
            //
            // For this enumerator the stable identity carried
            // in `device_path` is the Windows PnP device
            // instance ID (for example USB\VID_xxxx...).
            //
            // A semantic field rename belongs in a separate
            // refactor after physical acceptance.
            device_path: instance_id,
            connection_state: UsbConnectionState::Present,
        });
    }

    devices.sort_by(|left, right| {
        left.device_path
            .to_ascii_lowercase()
            .cmp(&right.device_path.to_ascii_lowercase())
    });

    devices.dedup_by(|left, right| left.device_path.eq_ignore_ascii_case(&right.device_path));

    let observation_state = if devices.is_empty() {
        UsbObservationState::UsbNotPresent
    } else {
        UsbObservationState::UsbPresent
    };

    UsbObservation {
        observation_state,
        devices,
        observed_at: observation_time(),
        source: SOURCE.to_string(),
    }
}

pub(crate) fn enumerate_usb_devices() -> UsbObservation {
    let device_info_set = match unsafe {
        SetupDiGetClassDevsW(None, PCWSTR::null(), None, DIGCF_PRESENT | DIGCF_ALLCLASSES)
    } {
        Ok(handle) => handle,

        Err(error) => {
            return UsbObservation::unknown(format!(
                "{SOURCE} could not create device information set: {error:?}"
            ));
        }
    };

    let observation = enumerate_from_device_info_set(device_info_set);

    let cleanup = unsafe { SetupDiDestroyDeviceInfoList(device_info_set) };

    if let Err(error) = cleanup {
        return UsbObservation::unknown(format!("{SOURCE} cleanup failed: {error:?}"));
    }

    observation
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usb_instance_id_filter_is_case_insensitive() {
        assert!(is_usb_instance_id("USB\\VID_04E8&PID_6860\\SERIAL"));

        assert!(is_usb_instance_id("usb\\vid_04e8&pid_6860\\serial"));

        assert!(!is_usb_instance_id("PCI\\VEN_1022&DEV_7914"));

        assert!(!is_usb_instance_id("SWD\\WPDBUSENUM\\DEVICE"));
    }

    #[test]
    fn setupapi_snapshot_is_internally_coherent() {
        let observation = enumerate_usb_devices();

        assert!(!observation.observed_at.is_empty());

        assert!(!observation.source.is_empty());

        match observation.observation_state {
            UsbObservationState::UsbPresent => {
                assert!(!observation.devices.is_empty());

                for device in &observation.devices {
                    assert!(!device.device_path.trim().is_empty());

                    assert!(is_usb_instance_id(&device.device_path));

                    assert_eq!(device.connection_state, UsbConnectionState::Present);
                }
            }

            UsbObservationState::UsbNotPresent => {
                assert!(observation.devices.is_empty());
            }

            UsbObservationState::UsbObservationUnknown => {
                assert!(observation.devices.is_empty());
            }
        }
    }

    #[test]
    fn successful_snapshot_has_unique_paths() {
        let observation = enumerate_usb_devices();

        if observation.observation_state != UsbObservationState::UsbPresent {
            return;
        }

        for left in 0..observation.devices.len() {
            for right in (left + 1)..observation.devices.len() {
                assert!(!observation.devices[left]
                    .device_path
                    .eq_ignore_ascii_case(&observation.devices[right].device_path));
            }
        }
    }
}
