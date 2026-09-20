use std::{ffi::c_void, ptr};

use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Devices::PortableDevices::{IPortableDeviceManager, PortableDeviceManager},
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_MULTITHREADED,
        },
    },
};

const MAX_WPD_DEVICES: u32 = 4096;
const MAX_WPD_ENUMERATION_ATTEMPTS: usize = 3;
const S_FALSE_HRESULT: windows::core::HRESULT = windows::core::HRESULT(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WpdDeviceDescriptor {
    pub(crate) pnp_device_id: String,
    pub(crate) friendly_name: Option<String>,
    pub(crate) manufacturer: Option<String>,
    pub(crate) description: Option<String>,
}

/// Balances every successful CoInitializeEx call with exactly one
/// CoUninitialize on the same thread.
struct ComApartment;

impl ComApartment {
    fn initialize_mta() -> Result<Self, String> {
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };

        result
            .ok()
            .map_err(|error| format!("WPD_COM_INITIALIZATION_FAILED: {error}"))?;

        Ok(Self)
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

/// Owns only device-ID strings allocated by Windows.
///
/// GetDevices fills the caller's PWSTR pointer array, while Windows owns
/// each returned string allocation until the caller releases it using
/// CoTaskMemFree.
struct TaskMemDeviceIds {
    values: Vec<PWSTR>,
}

impl TaskMemDeviceIds {
    fn new(count: usize) -> Self {
        Self {
            values: vec![PWSTR::null(); count],
        }
    }

    fn as_mut_ptr(&mut self) -> *mut PWSTR {
        self.values.as_mut_ptr()
    }

    fn values(&self) -> &[PWSTR] {
        &self.values
    }
}

impl Drop for TaskMemDeviceIds {
    fn drop(&mut self) {
        for value in &self.values {
            if value.is_null() {
                continue;
            }

            unsafe {
                CoTaskMemFree(Some(value.as_ptr() as *const c_void));
            }
        }
    }
}

#[derive(Clone, Copy)]
enum DeviceTextField {
    FriendlyName,
    Manufacturer,
    Description,
}

fn create_refreshed_manager() -> Result<IPortableDeviceManager, String> {
    let manager: IPortableDeviceManager =
        unsafe { CoCreateInstance(&PortableDeviceManager, None, CLSCTX_INPROC_SERVER) }
            .map_err(|error| format!("WPD_MANAGER_CREATE_FAILED: {error}"))?;

    unsafe { manager.RefreshDeviceList() }
        .map_err(|error| format!("WPD_MANAGER_REFRESH_FAILED: {error}"))?;

    Ok(manager)
}

fn get_devices_hresult(
    manager: &IPortableDeviceManager,
    output: *mut PWSTR,
    count: *mut u32,
) -> windows::core::HRESULT {
    unsafe {
        (windows::core::Interface::vtable(manager).GetDevices)(
            windows::core::Interface::as_raw(manager),
            output,
            count,
        )
    }
}
fn query_text(
    manager: &IPortableDeviceManager,
    device_id: PCWSTR,
    field: DeviceTextField,
    output: PWSTR,
    count: *mut u32,
) -> windows::core::Result<()> {
    unsafe {
        match field {
            DeviceTextField::FriendlyName => {
                manager.GetDeviceFriendlyName(device_id, output, count)
            }
            DeviceTextField::Manufacturer => {
                manager.GetDeviceManufacturer(device_id, output, count)
            }
            DeviceTextField::Description => manager.GetDeviceDescription(device_id, output, count),
        }
    }
}

/// Reads optional WPD display metadata.
///
/// Failure of one optional property never invalidates the authoritative
/// PnP device ID returned by GetDevices.
fn read_optional_text(
    manager: &IPortableDeviceManager,
    device_id: PCWSTR,
    field: DeviceTextField,
) -> Option<String> {
    let mut required_chars = 0u32;

    query_text(
        manager,
        device_id,
        field,
        PWSTR::null(),
        &mut required_chars,
    )
    .ok()?;

    if required_chars == 0 {
        return None;
    }

    let capacity = usize::try_from(required_chars).ok()?;

    if capacity == 0 {
        return None;
    }

    let mut buffer = vec![0u16; capacity];

    let mut supplied_chars = required_chars;

    query_text(
        manager,
        device_id,
        field,
        PWSTR::from_raw(buffer.as_mut_ptr()),
        &mut supplied_chars,
    )
    .ok()?;

    let supplied = usize::try_from(supplied_chars).ok()?;

    if supplied > buffer.len() {
        return None;
    }

    // WPD documents this count as including the null terminator.
    // The buffer was zero-initialized as an additional defensive bound.
    let search_len = supplied.max(1).min(buffer.len());

    let end = buffer[..search_len]
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(search_len);

    let text = String::from_utf16(&buffer[..end]).ok()?.trim().to_string();

    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Enumerates the current Windows Portable Device snapshot.
///
/// This operation:
/// - refreshes the WPD manager
/// - obtains PnP identities
/// - reads optional display metadata
///
/// It DOES NOT:
/// - open IPortableDevice
/// - enumerate device storage
/// - enumerate folders
/// - read file content
/// - copy content
/// - modify content
pub(crate) fn enumerate_devices() -> Result<Vec<WpdDeviceDescriptor>, String> {
    let _com = ComApartment::initialize_mta()?;

    let manager = create_refreshed_manager()?;

    let mut attempt = 0usize;

    let (raw_ids, output_count) = loop {
        attempt += 1;

        // First pass: Windows reports the required number of PWSTR entries.
        let mut required_count = 0u32;

        unsafe { manager.GetDevices(ptr::null_mut(), &mut required_count) }
            .map_err(|error| format!("WPD_DEVICE_COUNT_FAILED: {error}"))?;

        if required_count == 0 {
            return Ok(Vec::new());
        }

        // A defensive bound prevents a corrupt provider from requesting an
        // unreasonable host allocation.
        if required_count > MAX_WPD_DEVICES {
            return Err(format!("WPD_DEVICE_COUNT_INVALID: {required_count}"));
        }

        let allocation_count =
            usize::try_from(required_count).map_err(|_| "WPD_DEVICE_COUNT_OVERFLOW".to_string())?;

        let mut raw_ids = TaskMemDeviceIds::new(allocation_count);

        let mut output_count = required_count;

        // Preserve the raw HRESULT here. The generated windows-rs wrapper
        // converts successful HRESULT values into Result<()>, which would
        // discard the distinction between S_OK and S_FALSE.
        let result = get_devices_hresult(&manager, raw_ids.as_mut_ptr(), &mut output_count);

        if result == S_FALSE_HRESULT {
            if attempt >= MAX_WPD_ENUMERATION_ATTEMPTS {
                return Err(format!(
                    "WPD_DEVICE_ENUMERATION_UNSTABLE: attempts={attempt}"
                ));
            }

            // The WPD snapshot changed or exceeded the prior allocation.
            // Drop releases any returned task-memory strings before retrying.
            unsafe { manager.RefreshDeviceList() }
                .map_err(|error| format!("WPD_MANAGER_REFRESH_FAILED: {error}"))?;

            continue;
        }

        result
            .ok()
            .map_err(|error| format!("WPD_DEVICE_ENUMERATION_FAILED: {error}"))?;

        if output_count > required_count {
            return Err(format!(
                "WPD_DEVICE_COUNT_INCONSISTENT: allocated={required_count}, returned={output_count}"
            ));
        }

        let output_count =
            usize::try_from(output_count).map_err(|_| "WPD_OUTPUT_COUNT_OVERFLOW".to_string())?;

        break (raw_ids, output_count);
    };
    let mut devices = Vec::with_capacity(output_count);

    for raw_id in raw_ids.values().iter().take(output_count) {
        if raw_id.is_null() {
            return Err("WPD_NULL_DEVICE_ID".to_string());
        }

        let pnp_device_id = unsafe { raw_id.to_string() }
            .map_err(|error| format!("WPD_DEVICE_ID_UTF16_INVALID: {error}"))?;

        if pnp_device_id.trim().is_empty() {
            return Err("WPD_EMPTY_DEVICE_ID".to_string());
        }

        let device_id = PCWSTR::from_raw(raw_id.as_ptr() as *const u16);

        devices.push(WpdDeviceDescriptor {
            pnp_device_id,
            friendly_name: read_optional_text(&manager, device_id, DeviceTextField::FriendlyName),
            manufacturer: read_optional_text(&manager, device_id, DeviceTextField::Manufacturer),
            description: read_optional_text(&manager, device_id, DeviceTextField::Description),
        });
    }

    // Windows ordering is not part of our evidence contract.
    // CYVRA produces a deterministic snapshot.
    devices.sort_by(|left, right| {
        left.pnp_device_id
            .to_ascii_lowercase()
            .cmp(&right.pnp_device_id.to_ascii_lowercase())
    });

    devices.dedup_by(|left, right| {
        left.pnp_device_id
            .eq_ignore_ascii_case(&right.pnp_device_id)
    });

    Ok(devices)
}

#[cfg(test)]
mod tests {
    use super::enumerate_devices;

    #[test]
    fn portable_device_manager_enumerates_without_error() {
        enumerate_devices().expect("Windows WPD enumeration should succeed");
    }

    #[test]
    fn enumeration_is_sorted_and_unique() {
        let devices = enumerate_devices().expect("Windows WPD enumeration should succeed");

        for pair in devices.windows(2) {
            let left = pair[0].pnp_device_id.to_ascii_lowercase();

            let right = pair[1].pnp_device_id.to_ascii_lowercase();

            assert!(
                left < right,
                "WPD device snapshot must be deterministic and unique"
            );
        }
    }

    #[test]
    #[ignore = "requires the connected CYVRA Samsung Galaxy A10s acceptance handset"]
    fn connected_a10s_is_visible_through_wpd() {
        let devices = enumerate_devices().expect("real WPD enumeration should succeed");

        println!("WPD_DEVICE_COUNT={}", devices.len());

        for device in &devices {
            println!(
                "WPD_DEVICE friendly={:?} manufacturer={:?} description={:?}",
                device.friendly_name, device.manufacturer, device.description,
            );
        }

        let handset = devices.iter().find(|device| {
            let id = device.pnp_device_id.to_ascii_uppercase();

            let friendly = device
                .friendly_name
                .as_deref()
                .unwrap_or("")
                .to_ascii_uppercase();

            (id.contains("VID_04E8") && id.contains("PID_6860")) || friendly.contains("A10S")
        });

        assert!(
            handset.is_some(),
            "Connected Galaxy A10s was not visible through WPD"
        );

        let handset = handset.expect("handset existence checked above");

        println!("CYVRA_WPD_HANDSET_MATCH=true");

        println!("FRIENDLY_NAME={:?}", handset.friendly_name);

        println!("MANUFACTURER={:?}", handset.manufacturer);

        println!("DESCRIPTION={:?}", handset.description);
    }
}
