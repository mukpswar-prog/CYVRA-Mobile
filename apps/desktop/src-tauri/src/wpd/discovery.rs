use std::{ffi::c_void, fmt, ptr};

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

const WPD_COM_INITIALIZATION_FAILED: &str = "WPD_COM_INITIALIZATION_FAILED";
const WPD_MANAGER_CREATE_FAILED: &str = "WPD_MANAGER_CREATE_FAILED";
const WPD_MANAGER_REFRESH_FAILED: &str = "WPD_MANAGER_REFRESH_FAILED";
const WPD_DEVICE_COUNT_FAILED: &str = "WPD_DEVICE_COUNT_FAILED";
const WPD_DEVICE_COUNT_INVALID: &str = "WPD_DEVICE_COUNT_INVALID";
const WPD_DEVICE_COUNT_OVERFLOW: &str = "WPD_DEVICE_COUNT_OVERFLOW";
const WPD_DEVICE_ENUMERATION_UNSTABLE: &str = "WPD_DEVICE_ENUMERATION_UNSTABLE";
const WPD_DEVICE_ENUMERATION_FAILED: &str = "WPD_DEVICE_ENUMERATION_FAILED";
const WPD_DEVICE_COUNT_INCONSISTENT: &str = "WPD_DEVICE_COUNT_INCONSISTENT";
const WPD_OUTPUT_COUNT_OVERFLOW: &str = "WPD_OUTPUT_COUNT_OVERFLOW";
const WPD_NULL_DEVICE_ID: &str = "WPD_NULL_DEVICE_ID";
const WPD_DEVICE_ID_UTF16_INVALID: &str = "WPD_DEVICE_ID_UTF16_INVALID";
const WPD_EMPTY_DEVICE_ID: &str = "WPD_EMPTY_DEVICE_ID";

#[derive(Debug, PartialEq, Eq)]
struct WpdError {
    code: &'static str,
    detail: Option<String>,
}

impl WpdError {
    fn new(code: &'static str) -> Self {
        Self { code, detail: None }
    }

    fn with_detail(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: Some(detail.into()),
        }
    }
}

impl fmt::Display for WpdError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.detail {
            Some(detail) => write!(formatter, "{}: {}", self.code, detail),
            None => formatter.write_str(self.code),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EnumerationAction {
    Complete,
    Retry,
}

fn classify_enumeration_result(
    result: windows::core::HRESULT,
    attempt: usize,
) -> Result<EnumerationAction, WpdError> {
    if result == S_FALSE_HRESULT {
        if attempt >= MAX_WPD_ENUMERATION_ATTEMPTS {
            return Err(WpdError::with_detail(
                WPD_DEVICE_ENUMERATION_UNSTABLE,
                format!("attempts={attempt}"),
            ));
        }

        return Ok(EnumerationAction::Retry);
    }

    result
        .ok()
        .map_err(|error| WpdError::with_detail(WPD_DEVICE_ENUMERATION_FAILED, error.to_string()))?;

    Ok(EnumerationAction::Complete)
}

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

        result.ok().map_err(|error| {
            WpdError::with_detail(WPD_COM_INITIALIZATION_FAILED, error.to_string()).to_string()
        })?;

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
        unsafe { CoCreateInstance(&PortableDeviceManager, None, CLSCTX_INPROC_SERVER) }.map_err(
            |error| WpdError::with_detail(WPD_MANAGER_CREATE_FAILED, error.to_string()).to_string(),
        )?;

    unsafe { manager.RefreshDeviceList() }.map_err(|error| {
        WpdError::with_detail(WPD_MANAGER_REFRESH_FAILED, error.to_string()).to_string()
    })?;

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

        unsafe { manager.GetDevices(ptr::null_mut(), &mut required_count) }.map_err(|error| {
            WpdError::with_detail(WPD_DEVICE_COUNT_FAILED, error.to_string()).to_string()
        })?;

        if required_count == 0 {
            return Ok(Vec::new());
        }

        // A defensive bound prevents a corrupt provider from requesting an
        // unreasonable host allocation.
        if required_count > MAX_WPD_DEVICES {
            return Err(WpdError::with_detail(
                WPD_DEVICE_COUNT_INVALID,
                required_count.to_string(),
            )
            .to_string());
        }

        let allocation_count = usize::try_from(required_count)
            .map_err(|_| WpdError::new(WPD_DEVICE_COUNT_OVERFLOW).to_string())?;

        let mut raw_ids = TaskMemDeviceIds::new(allocation_count);

        let mut output_count = required_count;

        // Preserve the raw HRESULT here. The generated windows-rs wrapper
        // converts successful HRESULT values into Result<()>, which would
        // discard the distinction between S_OK and S_FALSE.
        let result = get_devices_hresult(&manager, raw_ids.as_mut_ptr(), &mut output_count);

        match classify_enumeration_result(result, attempt).map_err(|error| error.to_string())? {
            EnumerationAction::Retry => {
                // The WPD snapshot changed or exceeded the prior allocation.
                // Drop releases any returned task-memory strings before retrying.
                unsafe { manager.RefreshDeviceList() }.map_err(|error| {
                    WpdError::with_detail(WPD_MANAGER_REFRESH_FAILED, error.to_string()).to_string()
                })?;

                continue;
            }
            EnumerationAction::Complete => {}
        }

        if output_count > required_count {
            return Err(WpdError::with_detail(
                WPD_DEVICE_COUNT_INCONSISTENT,
                format!("allocated={required_count}, returned={output_count}"),
            )
            .to_string());
        }

        let output_count = usize::try_from(output_count)
            .map_err(|_| WpdError::new(WPD_OUTPUT_COUNT_OVERFLOW).to_string())?;

        break (raw_ids, output_count);
    };
    let mut devices = Vec::with_capacity(output_count);

    for raw_id in raw_ids.values().iter().take(output_count) {
        if raw_id.is_null() {
            return Err(WpdError::new(WPD_NULL_DEVICE_ID).to_string());
        }

        let pnp_device_id = unsafe { raw_id.to_string() }.map_err(|error| {
            WpdError::with_detail(WPD_DEVICE_ID_UTF16_INVALID, error.to_string()).to_string()
        })?;

        if pnp_device_id.trim().is_empty() {
            return Err(WpdError::new(WPD_EMPTY_DEVICE_ID).to_string());
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
    use super::{
        classify_enumeration_result, enumerate_devices, ComApartment, EnumerationAction, WpdError,
        MAX_WPD_ENUMERATION_ATTEMPTS, S_FALSE_HRESULT, WPD_DEVICE_ENUMERATION_FAILED,
        WPD_DEVICE_ENUMERATION_UNSTABLE, WPD_NULL_DEVICE_ID,
    };
    use std::ffi::c_void;
    use windows::{
        core::{HRESULT, PCWSTR, PWSTR},
        Win32::{
            Devices::PortableDevices::{
                IPortableDevice, IPortableDeviceKeyCollection, IPortableDeviceValues,
                PortableDeviceFTM, PortableDeviceValues, WPD_CLIENT_DESIRED_ACCESS,
                WPD_FUNCTIONAL_CATEGORY_STORAGE, WPD_FUNCTIONAL_OBJECT_CATEGORY,
            },
            Foundation::GENERIC_READ,
            System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER},
        },
    };

    #[test]
    fn classifier_accepts_s_ok() {
        let action =
            classify_enumeration_result(HRESULT(0), 1).expect("S_OK must complete enumeration");

        assert_eq!(action, EnumerationAction::Complete);
    }

    #[test]
    fn classifier_retries_s_false_before_final_attempt() {
        for attempt in 1..MAX_WPD_ENUMERATION_ATTEMPTS {
            let action = classify_enumeration_result(S_FALSE_HRESULT, attempt)
                .expect("S_FALSE before the final attempt must request a retry");

            assert_eq!(
                action,
                EnumerationAction::Retry,
                "attempt {attempt} must remain inside the retry window"
            );
        }
    }

    #[test]
    fn classifier_stops_on_third_s_false() {
        let error = classify_enumeration_result(S_FALSE_HRESULT, MAX_WPD_ENUMERATION_ATTEMPTS)
            .expect_err("third S_FALSE must stop retrying");

        assert_eq!(error.code, WPD_DEVICE_ENUMERATION_UNSTABLE);
        assert_eq!(
            error.to_string(),
            "WPD_DEVICE_ENUMERATION_UNSTABLE: attempts=3"
        );
    }

    #[test]
    fn classifier_failed_hresult_has_stable_error_code() {
        let failed = HRESULT(0x80004005u32 as i32);

        let error = classify_enumeration_result(failed, 1)
            .expect_err("failed HRESULT must fail enumeration");

        assert_eq!(error.code, WPD_DEVICE_ENUMERATION_FAILED);
        assert!(
            error
                .to_string()
                .starts_with("WPD_DEVICE_ENUMERATION_FAILED: "),
            "failure detail must retain the stable CYVRA error-code prefix"
        );
    }

    #[test]
    fn wpd_error_without_detail_preserves_stable_code() {
        let error = WpdError::new(WPD_NULL_DEVICE_ID);

        assert_eq!(error.code, WPD_NULL_DEVICE_ID);
        assert_eq!(error.to_string(), "WPD_NULL_DEVICE_ID");
    }
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

        // G4 hardware acceptance: explicitly request read-only WPD access.
        // No content interface is requested and no customer object is opened.
        let _com = ComApartment::initialize_mta().expect("G4 COM initialization must succeed");

        let client_info: IPortableDeviceValues =
            unsafe { CoCreateInstance(&PortableDeviceValues, None, CLSCTX_INPROC_SERVER) }
                .expect("G4 PortableDeviceValues creation must succeed");

        unsafe { client_info.SetUnsignedIntegerValue(&WPD_CLIENT_DESIRED_ACCESS, GENERIC_READ.0) }
            .expect("G4 explicit GENERIC_READ configuration must succeed");

        let device: IPortableDevice =
            unsafe { CoCreateInstance(&PortableDeviceFTM, None, CLSCTX_INPROC_SERVER) }
                .expect("G4 PortableDeviceFTM creation must succeed");

        let pnp_device_id = handset
            .pnp_device_id
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();

        unsafe { device.Open(PCWSTR::from_raw(pnp_device_id.as_ptr()), &client_info) }
            .expect("G4 Samsung handset must open through explicit read-only WPD access");

        println!("CYVRA_WPD_READ_ONLY_OPEN=true");
        println!("CYVRA_WPD_DESIRED_ACCESS=GENERIC_READ");

        // G5: enumerate only immediate children of the WPD root object.
        // No recursive traversal and no customer content streams are opened.
        let content = unsafe { device.Content() }
            .expect("G5 read-only WPD Content interface must be available");

        let root_id = "DEVICE"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();

        let enumerator = unsafe {
            content.EnumObjects(
                0,
                PCWSTR::from_raw(root_id.as_ptr()),
                None::<&IPortableDeviceValues>,
            )
        }
        .expect("G5 root object enumeration must start");

        let properties =
            unsafe { content.Properties() }.expect("G5 WPD properties interface must be available");

        const MAX_G5_ROOT_OBJECTS: usize = 64;

        let mut root_object_count = 0usize;
        let mut storage_object_count = 0usize;

        loop {
            assert!(
                root_object_count < MAX_G5_ROOT_OBJECTS,
                "G5 root enumeration exceeded defensive bound"
            );

            let mut raw_ids = [PWSTR::null()];
            let mut fetched = 0u32;

            let result = unsafe { enumerator.Next(&mut raw_ids, &mut fetched) };

            result.ok().expect("G5 root object enumeration failed");

            if fetched == 0 {
                break;
            }

            assert_eq!(
                fetched, 1,
                "G5 single-object enumeration returned unexpected count"
            );

            let raw_id = raw_ids[0];

            assert!(!raw_id.is_null(), "G5 returned a null root object ID");

            let object_id =
                unsafe { raw_id.to_string() }.expect("G5 root object ID must contain valid UTF-16");

            unsafe {
                CoTaskMemFree(Some(raw_id.as_ptr() as *const c_void));
            }

            root_object_count += 1;

            let object_id_wide = object_id
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>();

            // NULL key collection deliberately requests properties only;
            // it does not request or open the object data stream.
            let values = unsafe {
                properties.GetValues(
                    PCWSTR::from_raw(object_id_wide.as_ptr()),
                    None::<&IPortableDeviceKeyCollection>,
                )
            }
            .expect("G5 root object property retrieval must succeed");

            let category = unsafe { values.GetGuidValue(&WPD_FUNCTIONAL_OBJECT_CATEGORY) };

            let is_storage = category
                .as_ref()
                .is_ok_and(|category| *category == WPD_FUNCTIONAL_CATEGORY_STORAGE);

            println!("G5_ROOT_OBJECT id={object_id:?} storage={is_storage}");

            if is_storage {
                storage_object_count += 1;
            }
        }

        assert!(
            root_object_count > 0,
            "G5 WPD root exposed no immediate objects"
        );

        assert!(
            storage_object_count > 0,
            "G5 did not discover a WPD storage functional object"
        );

        println!("CYVRA_WPD_ROOT_OBJECT_COUNT={root_object_count}");
        println!("CYVRA_WPD_STORAGE_OBJECT_COUNT={storage_object_count}");
        println!("CYVRA_WPD_STORAGE_FUNCTIONAL_OBJECT=true");

        unsafe { device.Close() }.expect("G4 WPD device Close must succeed");

        println!("CYVRA_WPD_READ_ONLY_CLOSE=true");
    }
}
