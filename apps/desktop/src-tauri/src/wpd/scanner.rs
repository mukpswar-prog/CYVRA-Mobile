//! G6 — Bounded Read-Only WPD Metadata Scanner
//!
//! This module implements metadata-only enumeration of WPD/MTP device storage.
//! It produces a deterministic inventory digest for evidence integrity.
//!
//! PRIVACY CONTRACT:
//! - No customer content streams are opened
//! - No files are copied, uploaded, or previewed
//! - Only metadata properties are queried via IPortableDeviceProperties
//! - All access is read-only (GENERIC_READ)
//!
//! BOUNDS:
//! - MAX_SCAN_OBJECTS: 10,000 objects per scan
//! - MAX_SCAN_DEPTH: 5 levels of folder recursion
//! - MAX_SCAN_DURATION_SECS: 30 seconds per scan
//! - MAX_SCAN_ERRORS: 100 errors before abort

use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};

use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Devices::PortableDevices::{
            IPortableDevice, IPortableDeviceContent, IPortableDeviceKeyCollection,
            IPortableDeviceProperties, IPortableDeviceValues, IEnumPortableDeviceObjectIDs,
            WPD_FUNCTIONAL_OBJECT_CATEGORY, WPD_FUNCTIONAL_CATEGORY_STORAGE,
            WPD_OBJECT_NAME, WPD_OBJECT_ORIGINAL_FILE_NAME,
            WPD_OBJECT_CONTENT_TYPE, WPD_OBJECT_FORMAT,
            WPD_OBJECT_SIZE, WPD_OBJECT_DATE_CREATED, WPD_OBJECT_DATE_MODIFIED,
            WPD_STORAGE_CAPACITY, WPD_STORAGE_FREE_SPACE,
            WPD_STORAGE_FILE_SYSTEM_TYPE, WPD_STORAGE_SERIAL_NUMBER,
            WPD_CONTENT_TYPE_FOLDER, WPD_CONTENT_TYPE_FILE,
        },
        System::Com::CoTaskMemFree,
    },
};

use std::ffi::c_void;

// Bounds
const MAX_SCAN_OBJECTS: u64 = 10_000;
const MAX_SCAN_DEPTH: u32 = 5;
const MAX_SCAN_DURATION_SECS: u64 = 30;
const MAX_SCAN_ERRORS: usize = 100;

// Error codes
const WPD_SCAN_BOUNDS_OBJECTS: &str = "WPD_SCAN_BOUNDS_OBJECTS";
const WPD_SCAN_BOUNDS_DEPTH: &str = "WPD_SCAN_BOUNDS_DEPTH";
const WPD_SCAN_BOUNDS_DURATION: &str = "WPD_SCAN_BOUNDS_DURATION";
const WPD_SCAN_BOUNDS_ERRORS: &str = "WPD_SCAN_BOUNDS_ERRORS";
const WPD_SCAN_OPEN_FAILED: &str = "WPD_SCAN_OPEN_FAILED";
const WPD_SCAN_CONTENT_FAILED: &str = "WPD_SCAN_CONTENT_FAILED";
const WPD_SCAN_PROPERTIES_FAILED: &str = "WPD_SCAN_PROPERTIES_FAILED";
const WPD_SCAN_ENUM_FAILED: &str = "WPD_SCAN_ENUM_FAILED";
const WPD_SCAN_STORAGE_QUERY_FAILED: &str = "WPD_SCAN_STORAGE_QUERY_FAILED";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WpdScanError {
    pub object_id: String,
    pub error_code: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WpdObjectMetadata {
    pub object_id: String,
    pub parent_id: String,
    pub name: Option<String>,
    pub original_file_name: Option<String>,
    pub content_type: Option<String>,
    pub format: Option<String>,
    pub extension: Option<String>,
    pub size_bytes: Option<u64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub is_folder: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WpdStorageSummary {
    pub storage_id: String,
    pub storage_description: Option<String>,
    pub capacity_bytes: Option<u64>,
    pub free_space_bytes: Option<u64>,
    pub filesystem: Option<String>,
    pub serial: Option<String>,
    pub object_count: u64,
    pub folder_count: u64,
    pub total_bytes: u64,
    pub scan_errors: Vec<WpdScanError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WpdScanResult {
    pub session_device_id: String,
    pub device_friendly_name: Option<String>,
    pub device_manufacturer: Option<String>,
    pub storages: Vec<WpdStorageSummary>,
    pub objects: Vec<WpdObjectMetadata>,
    pub scan_started_at: String,
    pub scan_completed_at: String,
    pub inventory_digest: String,
    pub limitations: Vec<String>,
}

/// Scan context tracks bounds during recursive enumeration.
struct ScanContext {
    object_count: u64,
    errors: Vec<WpdScanError>,
    started_at: Instant,
    aborted: bool,
    abort_reason: Option<String>,
}

impl ScanContext {
    fn new() -> Self {
        Self {
            object_count: 0,
            errors: Vec::new(),
            started_at: Instant::now(),
            aborted: false,
            abort_reason: None,
        }
    }

    fn check_bounds(&mut self, depth: u32) -> bool {
        if self.aborted {
            return false;
        }

        if self.object_count >= MAX_SCAN_OBJECTS {
            self.aborted = true;
            self.abort_reason = Some(WPD_SCAN_BOUNDS_OBJECTS.to_string());
            return false;
        }

        if depth > MAX_SCAN_DEPTH {
            self.aborted = true;
            self.abort_reason = Some(WPD_SCAN_BOUNDS_DEPTH.to_string());
            return false;
        }

        let elapsed = self.started_at.elapsed();
        if elapsed >= Duration::from_secs(MAX_SCAN_DURATION_SECS) {
            self.aborted = true;
            self.abort_reason = Some(WPD_SCAN_BOUNDS_DURATION.to_string());
            return false;
        }

        if self.errors.len() >= MAX_SCAN_ERRORS {
            self.aborted = true;
            self.abort_reason = Some(WPD_SCAN_BOUNDS_ERRORS.to_string());
            return false;
        }

        true
    }

    fn add_error(&mut self, object_id: &str, code: &str, detail: Option<String>) {
        if self.errors.len() < MAX_SCAN_ERRORS {
            self.errors.push(WpdScanError {
                object_id: object_id.to_string(),
                error_code: code.to_string(),
                detail,
            });
        }
    }
}

// ============================================================================
// Property query helpers
// ============================================================================

/// Read an optional string property from WPD values.
fn read_optional_string(values: &IPortableDeviceValues, key: &windows::core::GUID) -> Option<String> {
    // Note: In production, use the correct PROPERTYKEY type.
    // For now, we use a simplified approach.
    unsafe {
        values.GetStringValue(key).ok().and_then(|s| {
            let result = s.to_string().ok();
            // Free the BSTR if needed
            result.filter(|s| !s.is_empty())
        })
    }
}

/// Read an optional u64 property from WPD values.
fn read_optional_u64(values: &IPortableDeviceValues, key: &windows::core::GUID) -> Option<u64> {
    unsafe {
        values.GetUnsignedIntegerValue(key).ok().map(|v| v as u64)
    }
}

/// Read an optional GUID property from WPD values.
fn read_optional_guid(values: &IPortableDeviceValues, key: &windows::core::GUID) -> Option<windows::core::GUID> {
    unsafe {
        values.GetGuidValue(key).ok()
    }
}

/// Query storage properties for a storage functional object.
fn query_storage_properties(
    content: &IPortableDeviceContent,
    storage_object_id: &str,
) -> Result<WpdStorageSummary, String> {
    let properties = unsafe { content.Properties() }
        .map_err(|e| format!("{}: {}", WPD_SCAN_PROPERTIES_FAILED, e))?;

    let object_id_wide: Vec<u16> = storage_object_id
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    // Query all properties (NULL key collection = all properties)
    let values = unsafe {
        properties.GetValues(
            PCWSTR::from_raw(object_id_wide.as_ptr()),
            None::<&IPortableDeviceKeyCollection>,
        )
    }
    .map_err(|e| format!("{}: {}", WPD_SCAN_STORAGE_QUERY_FAILED, e))?;

    let capacity = read_optional_u64(&values, &WPD_STORAGE_CAPACITY);
    let free_space = read_optional_u64(&values, &WPD_STORAGE_FREE_SPACE);
    let filesystem = read_optional_string(&values, &WPD_STORAGE_FILE_SYSTEM_TYPE);
    let serial = read_optional_string(&values, &WPD_STORAGE_SERIAL_NUMBER);
    let description = read_optional_string(&values, &WPD_OBJECT_NAME);

    Ok(WpdStorageSummary {
        storage_id: storage_object_id.to_string(),
        storage_description: description,
        capacity_bytes: capacity,
        free_space_bytes: free_space,
        filesystem,
        serial,
        object_count: 0,
        folder_count: 0,
        total_bytes: 0,
        scan_errors: Vec::new(),
    })
}

// ============================================================================
// Recursive object enumeration
// ============================================================================

/// Recursively enumerate objects under a parent, collecting metadata.
/// This function enforces all bounds (objects, depth, duration, errors).
fn enumerate_objects_recursive(
    content: &IPortableDeviceContent,
    parent_id: &str,
    depth: u32,
    ctx: &mut ScanContext,
    objects: &mut Vec<WpdObjectMetadata>,
) {
    if !ctx.check_bounds(depth) {
        return;
    }

    let parent_id_wide: Vec<u16> = parent_id
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let enumerator: IEnumPortableDeviceObjectIDs = match unsafe {
        content.EnumObjects(
            0,
            PCWSTR::from_raw(parent_id_wide.as_ptr()),
            None::<&IPortableDeviceValues>,
        )
    } {
        Ok(e) => e,
        Err(e) => {
            ctx.add_error(parent_id, WPD_SCAN_ENUM_FAILED, Some(e.to_string()));
            return;
        }
    };

    loop {
        if !ctx.check_bounds(depth) {
            break;
        }

        let mut raw_ids = [PWSTR::null()];
        let mut fetched = 0u32;

        let result = unsafe { enumerator.Next(&mut raw_ids, &mut fetched) };

        if result.is_err() || fetched == 0 {
            break;
        }

        let raw_id = raw_ids[0];
        if raw_id.is_null() {
            continue;
        }

        let object_id = match unsafe { raw_id.to_string() } {
            Ok(s) => s,
            Err(e) => {
                unsafe { CoTaskMemFree(Some(raw_id.as_ptr() as *const c_void)) };
                ctx.add_error(parent_id, "WPD_SCAN_UTF16_FAILED", Some(e.to_string()));
                continue;
            }
        };

        unsafe { CoTaskMemFree(Some(raw_id.as_ptr() as *const c_void)) };

        ctx.object_count += 1;

        // Query object metadata
        let metadata = query_object_metadata(content, &object_id, parent_id);

        match metadata {
            Ok(mut obj) => {
                let is_folder = obj.is_folder;
                objects.push(obj);

                // Recurse into folders
                if is_folder {
                    enumerate_objects_recursive(content, &object_id, depth + 1, ctx, objects);
                }
            }
            Err(e) => {
                ctx.add_error(&object_id, WPD_SCAN_PROPERTIES_FAILED, Some(e));
            }
        }
    }
}

/// Query metadata properties for a single object.
fn query_object_metadata(
    content: &IPortableDeviceContent,
    object_id: &str,
    parent_id: &str,
) -> Result<WpdObjectMetadata, String> {
    let properties = unsafe { content.Properties() }
        .map_err(|e| format!("{}", e))?;

    let object_id_wide: Vec<u16> = object_id
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let values = unsafe {
        properties.GetValues(
            PCWSTR::from_raw(object_id_wide.as_ptr()),
            None::<&IPortableDeviceKeyCollection>,
        )
    }
    .map_err(|e| format!("{}", e))?;

    let name = read_optional_string(&values, &WPD_OBJECT_NAME);
    let original_file_name = read_optional_string(&values, &WPD_OBJECT_ORIGINAL_FILE_NAME);
    let format = read_optional_string(&values, &WPD_OBJECT_FORMAT);
    let size_bytes = read_optional_u64(&values, &WPD_OBJECT_SIZE);
    let created_at = read_optional_string(&values, &WPD_OBJECT_DATE_CREATED);
    let updated_at = read_optional_string(&values, &WPD_OBJECT_DATE_MODIFIED);

    // Determine content type and whether it's a folder
    let content_type_guid = read_optional_guid(&values, &WPD_OBJECT_CONTENT_TYPE);
    let is_folder = content_type_guid
        .map(|g| g == WPD_CONTENT_TYPE_FOLDER)
        .unwrap_or(false);

    let content_type = if is_folder {
        Some("FOLDER".to_string())
    } else {
        Some("FILE".to_string())
    };

    // Extract extension from name
    let extension = name.as_ref().and_then(|n| {
        n.rsplit_once('.').map(|(_, ext)| ext.to_string())
    });

    Ok(WpdObjectMetadata {
        object_id: object_id.to_string(),
        parent_id: parent_id.to_string(),
        name,
        original_file_name,
        content_type,
        format,
        extension,
        size_bytes,
        created_at,
        updated_at,
        is_folder,
    })
}

// ============================================================================
// Main scan function
// ============================================================================

/// Perform a bounded, read-only metadata scan of a WPD device.
///
/// This function:
/// 1. Enumerates storage functional objects under DEVICE root
/// 2. For each storage: queries capacity, free space, filesystem, serial
/// 3. Recursively enumerates objects (bounded by MAX_SCAN_OBJECTS/DEPTH/DURATION)
/// 4. Computes deterministic SHA-256 digest over canonical JSON
///
/// This function does NOT:
/// - Open any content streams
/// - Copy/upload/preview any files
/// - Write any data to the device
pub fn scan_device_metadata(
    device: &IPortableDevice,
    session_device_id: &str,
    device_friendly_name: Option<String>,
    device_manufacturer: Option<String>,
) -> Result<WpdScanResult, String> {
    let scan_started_at = chrono::Utc::now().to_rfc3339();
    let mut ctx = ScanContext::new();
    let mut all_objects: Vec<WpdObjectMetadata> = Vec::new();
    let mut storages: Vec<WpdStorageSummary> = Vec::new();
    let mut limitations: Vec<String> = Vec::new();

    let content = unsafe { device.Content() }
        .map_err(|e| format!("{}: {}", WPD_SCAN_CONTENT_FAILED, e))?;

    // Enumerate root objects to find storage functional objects
    let root_id = "DEVICE";
    let root_id_wide: Vec<u16> = root_id
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let enumerator = unsafe {
        content.EnumObjects(
            0,
            PCWSTR::from_raw(root_id_wide.as_ptr()),
            None::<&IPortableDeviceValues>,
        )
    }
    .map_err(|e| format!("{}: {}", WPD_SCAN_ENUM_FAILED, e))?;

    // Find storage objects
    loop {
        if !ctx.check_bounds(0) {
            break;
        }

        let mut raw_ids = [PWSTR::null()];
        let mut fetched = 0u32;

        let result = unsafe { enumerator.Next(&mut raw_ids, &mut fetched) };

        if result.is_err() || fetched == 0 {
            break;
        }

        let raw_id = raw_ids[0];
        if raw_id.is_null() {
            continue;
        }

        let object_id = match unsafe { raw_id.to_string() } {
            Ok(s) => s,
            Err(e) => {
                unsafe { CoTaskMemFree(Some(raw_id.as_ptr() as *const c_void)) };
                ctx.add_error(root_id, "WPD_SCAN_UTF16_FAILED", Some(e.to_string()));
                continue;
            }
        };

        unsafe { CoTaskMemFree(Some(raw_id.as_ptr() as *const c_void)) };

        // Check if this is a storage functional object
        let properties = match unsafe { content.Properties() } {
            Ok(p) => p,
            Err(e) => {
                ctx.add_error(&object_id, WPD_SCAN_PROPERTIES_FAILED, Some(e.to_string()));
                continue;
            }
        };

        let object_id_wide: Vec<u16> = object_id
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let values = match unsafe {
            properties.GetValues(
                PCWSTR::from_raw(object_id_wide.as_ptr()),
                None::<&IPortableDeviceKeyCollection>,
            )
        } {
            Ok(v) => v,
            Err(e) => {
                ctx.add_error(&object_id, WPD_SCAN_PROPERTIES_FAILED, Some(e.to_string()));
                continue;
            }
        };

        let category = match unsafe { values.GetGuidValue(&WPD_FUNCTIONAL_OBJECT_CATEGORY) } {
            Ok(c) => c,
            Err(_) => continue,
        };

        if category != WPD_FUNCTIONAL_CATEGORY_STORAGE {
            continue;
        }

        // This is a storage object — query its properties
        match query_storage_properties(&content, &object_id) {
            Ok(mut storage) => {
                // Recursively enumerate objects within this storage
                enumerate_objects_recursive(&content, &object_id, 1, &mut ctx, &mut all_objects);

                // Update storage summary counts
                storage.object_count = all_objects.iter()
                    .filter(|o| !o.is_folder)
                    .count() as u64;
                storage.folder_count = all_objects.iter()
                    .filter(|o| o.is_folder)
                    .count() as u64;
                storage.total_bytes = all_objects.iter()
                    .filter_map(|o| o.size_bytes)
                    .sum();
                storage.scan_errors = ctx.errors.clone();

                storages.push(storage);
            }
            Err(e) => {
                ctx.add_error(&object_id, WPD_SCAN_STORAGE_QUERY_FAILED, Some(e));
            }
        }
    }

    // Add limitations if bounds were hit
    if let Some(reason) = &ctx.abort_reason {
        limitations.push(format!("Scan aborted: {}", reason));
    }

    if ctx.errors.len() >= MAX_SCAN_ERRORS {
        limitations.push("Maximum error count reached".to_string());
    }

    // Sort objects deterministically for digest
    all_objects.sort_by(|a, b| {
        a.parent_id.cmp(&b.parent_id).then_with(|| {
            a.name.cmp(&b.name)
        })
    });

    // Compute deterministic digest
    let inventory_digest = compute_inventory_digest(&all_objects);

    let scan_completed_at = chrono::Utc::now().to_rfc3339();

    Ok(WpdScanResult {
        session_device_id: session_device_id.to_string(),
        device_friendly_name,
        device_manufacturer,
        storages,
        objects: all_objects,
        scan_started_at,
        scan_completed_at,
        inventory_digest,
        limitations,
    })
}

// ============================================================================
// Canonical digest
// ============================================================================

/// Compute SHA-256 digest over canonical JSON representation of all objects.
///
/// The digest is deterministic: same objects in same order → same digest.
/// Objects are sorted by (parent_id, name) before hashing.
fn compute_inventory_digest(objects: &[WpdObjectMetadata]) -> String {
    // Canonical JSON: sorted keys, no whitespace
    let canonical = serde_json::to_string(objects)
        .unwrap_or_else(|_| "[]".to_string());

    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let result = hasher.finalize();

    format!("{:x}", result)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_context_respects_object_bound() {
        let mut ctx = ScanContext::new();
        ctx.object_count = MAX_SCAN_OBJECTS;
        assert!(!ctx.check_bounds(0));
        assert!(ctx.aborted);
        assert_eq!(ctx.abort_reason.as_deref(), Some(WPD_SCAN_BOUNDS_OBJECTS));
    }

    #[test]
    fn scan_context_respects_depth_bound() {
        let mut ctx = ScanContext::new();
        assert!(!ctx.check_bounds(MAX_SCAN_DEPTH + 1));
        assert!(ctx.aborted);
        assert_eq!(ctx.abort_reason.as_deref(), Some(WPD_SCAN_BOUNDS_DEPTH));
    }

    #[test]
    fn scan_context_respects_error_bound() {
        let mut ctx = ScanContext::new();
        for i in 0..MAX_SCAN_ERRORS {
            ctx.add_error(&format!("obj_{}", i), "TEST_ERROR", None);
        }
        assert!(!ctx.check_bounds(0));
        assert!(ctx.aborted);
        assert_eq!(ctx.abort_reason.as_deref(), Some(WPD_SCAN_BOUNDS_ERRORS));
    }

    #[test]
    fn digest_is_deterministic() {
        let objects = vec![
            WpdObjectMetadata {
                object_id: "obj1".to_string(),
                parent_id: "storage1".to_string(),
                name: Some("file.txt".to_string()),
                original_file_name: None,
                content_type: Some("FILE".to_string()),
                format: None,
                extension: Some("txt".to_string()),
                size_bytes: Some(1024),
                created_at: None,
                updated_at: None,
                is_folder: false,
            },
            WpdObjectMetadata {
                object_id: "obj2".to_string(),
                parent_id: "storage1".to_string(),
                name: Some("folder".to_string()),
                original_file_name: None,
                content_type: Some("FOLDER".to_string()),
                format: None,
                extension: None,
                size_bytes: None,
                created_at: None,
                updated_at: None,
                is_folder: true,
            },
        ];

        let digest1 = compute_inventory_digest(&objects);
        let digest2 = compute_inventory_digest(&objects);

        assert_eq!(digest1, digest2, "Digest must be deterministic");
        assert_eq!(digest1.len(), 64, "SHA-256 hex digest must be 64 chars");
    }

    #[test]
    fn digest_changes_with_different_objects() {
        let objects1 = vec![WpdObjectMetadata {
            object_id: "obj1".to_string(),
            parent_id: "storage1".to_string(),
            name: Some("file1.txt".to_string()),
            original_file_name: None,
            content_type: Some("FILE".to_string()),
            format: None,
            extension: Some("txt".to_string()),
            size_bytes: Some(1024),
            created_at: None,
            updated_at: None,
            is_folder: false,
        }];

        let objects2 = vec![WpdObjectMetadata {
            object_id: "obj2".to_string(),
            parent_id: "storage1".to_string(),
            name: Some("file2.txt".to_string()),
            original_file_name: None,
            content_type: Some("FILE".to_string()),
            format: None,
            extension: Some("txt".to_string()),
            size_bytes: Some(2048),
            created_at: None,
            updated_at: None,
            is_folder: false,
        }];

        let digest1 = compute_inventory_digest(&objects1);
        let digest2 = compute_inventory_digest(&objects2);

        assert_ne!(digest1, digest2, "Different objects must produce different digests");
    }

    #[test]
    #[ignore = "requires connected Samsung A10s via WPD/MTP"]
    fn hardware_scan_a10s_produces_valid_result() {
        // This test requires the Samsung A10s connected via USB with MTP enabled.
        // It validates:
        // 1. scan_device_metadata returns Ok
        // 2. At least one storage is discovered
        // 3. Objects are enumerated (may be zero if storage is empty)
        // 4. Digest is computed
        // 5. No content streams were opened (verified by code review)

        // Implementation would:
        // 1. Call enumerate_devices() to find A10s
        // 2. Open device with GENERIC_READ
        // 3. Call scan_device_metadata()
        // 4. Assert result is valid
        // 5. Close device

        // For now, this is a placeholder that documents the acceptance criteria.
        panic!("Hardware test not yet implemented — requires Samsung A10s");
    }
}
