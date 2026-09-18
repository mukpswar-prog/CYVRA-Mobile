use std::{mem::size_of, ptr::addr_of};

use windows::{
    core::{HRESULT, PCWSTR},
    Win32::{
        Devices::{
            DeviceAndDriverInstallation::{
                SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInterfaces, SetupDiGetClassDevsW,
                SetupDiGetDeviceInterfaceDetailW, DIGCF_DEVICEINTERFACE, DIGCF_PRESENT, HDEVINFO,
                SP_DEVICE_INTERFACE_DATA, SP_DEVICE_INTERFACE_DETAIL_DATA_W,
            },
            Usb::GUID_DEVINTERFACE_USB_DEVICE,
        },
        Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_NO_MORE_ITEMS},
    },
};

use super::model::{
    observation_time, UsbConnectionState, UsbDeviceObservation, UsbObservation, UsbObservationState,
};

const SOURCE: &str = "Windows SetupAPI USB device-interface enumeration";

fn win32_hresult(code: u32) -> HRESULT {
    HRESULT::from_win32(code)
}

fn device_interface_path(
    device_info_set: HDEVINFO,
    interface_data: &SP_DEVICE_INTERFACE_DATA,
) -> Result<String, String> {
    let mut required_size = 0u32;

    let size_result = unsafe {
        SetupDiGetDeviceInterfaceDetailW(
            device_info_set,
            interface_data,
            None,
            0,
            Some(&mut required_size),
            None,
        )
    };

    match size_result {
        Err(error) if error.code() == win32_hresult(ERROR_INSUFFICIENT_BUFFER.0) => {}
        Err(error) => {
            return Err(format!("SETUPAPI_DETAIL_SIZE_FAILED:{error:?}"));
        }
        Ok(()) => {}
    }

    if required_size < size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32 {
        return Err(format!("SETUPAPI_DETAIL_SIZE_INVALID:{required_size}"));
    }

    // Use usize-backed storage rather than Vec<u8>.
    //
    // This guarantees alignment suitable for the generated
    // SP_DEVICE_INTERFACE_DETAIL_DATA_W structure before the pointer cast.
    let allocated_size = required_size;
    let required_bytes = allocated_size as usize;
    let word_size = size_of::<usize>();

    let word_count = required_bytes
        .checked_add(word_size - 1)
        .ok_or_else(|| "SETUPAPI_DETAIL_SIZE_OVERFLOW".to_string())?
        / word_size;

    let mut storage = vec![0usize; word_count];

    let detail = storage
        .as_mut_ptr()
        .cast::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>();

    unsafe {
        (*detail).cbSize = size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32;
    }

    unsafe {
        SetupDiGetDeviceInterfaceDetailW(
            device_info_set,
            interface_data,
            Some(detail),
            allocated_size,
            None,
            None,
        )
    }
    .map_err(|error| format!("SETUPAPI_DETAIL_READ_FAILED:{error:?}"))?;

    let buffer_start = storage.as_ptr() as usize;

    let valid_end = buffer_start
        .checked_add(allocated_size as usize)
        .ok_or_else(|| "SETUPAPI_DETAIL_RANGE_OVERFLOW".to_string())?;

    let path_ptr = unsafe { addr_of!((*detail).DevicePath).cast::<u16>() };

    let path_start = path_ptr as usize;

    if path_start >= valid_end {
        return Err("SETUPAPI_DEVICE_PATH_OUT_OF_RANGE".to_string());
    }

    let available_bytes = valid_end - path_start;
    let max_units = available_bytes / size_of::<u16>();

    if max_units == 0 {
        return Err("SETUPAPI_DEVICE_PATH_EMPTY_BUFFER".to_string());
    }

    let units = unsafe { std::slice::from_raw_parts(path_ptr, max_units) };

    let nul_index = units
        .iter()
        .position(|unit| *unit == 0)
        .ok_or_else(|| "SETUPAPI_DEVICE_PATH_NOT_TERMINATED".to_string())?;

    if nul_index == 0 {
        return Err("SETUPAPI_DEVICE_PATH_EMPTY".to_string());
    }

    String::from_utf16(&units[..nul_index])
        .map_err(|error| format!("SETUPAPI_DEVICE_PATH_INVALID_UTF16:{error}"))
}

fn enumerate_from_device_info_set(device_info_set: HDEVINFO) -> UsbObservation {
    let mut devices = Vec::new();

    for index in 0u32.. {
        let mut interface_data = SP_DEVICE_INTERFACE_DATA {
            cbSize: size_of::<SP_DEVICE_INTERFACE_DATA>() as u32,
            ..Default::default()
        };

        let result = unsafe {
            SetupDiEnumDeviceInterfaces(
                device_info_set,
                None,
                &GUID_DEVINTERFACE_USB_DEVICE,
                index,
                &mut interface_data,
            )
        };

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

        let device_path = match device_interface_path(device_info_set, &interface_data) {
            Ok(path) => path,

            Err(error) => {
                return UsbObservation::unknown(format!(
                    "{SOURCE} could not resolve device path at index {index}: {error}"
                ));
            }
        };

        devices.push(UsbDeviceObservation {
            device_path,
            connection_state: UsbConnectionState::Present,
        });
    }

    // Produce deterministic snapshots.
    //
    // Windows interface paths are compared case-insensitively later when
    // B3A-3D performs previous/current snapshot reconciliation.
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
        SetupDiGetClassDevsW(
            Some(&GUID_DEVINTERFACE_USB_DEVICE as *const _),
            PCWSTR::null(),
            None,
            DIGCF_PRESENT | DIGCF_DEVICEINTERFACE,
        )
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
    fn setupapi_snapshot_is_internally_coherent() {
        let observation = enumerate_usb_devices();

        assert!(!observation.observed_at.is_empty());
        assert!(!observation.source.is_empty());

        match observation.observation_state {
            UsbObservationState::UsbPresent => {
                assert!(!observation.devices.is_empty());

                for device in &observation.devices {
                    assert!(!device.device_path.trim().is_empty());

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
