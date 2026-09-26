# G6 — Bounded Read-Only WPD Metadata Scanner

**Status:** IMPLEMENTED AND HARDWARE-VALIDATED  
**Date:** 2026-09-26  
**Gate:** G6 from canonical engineering guideline

## Purpose

G6 implements bounded, read-only, metadata-only WPD/MTP device scanning for CYVRA Mobile evidence.

## Scope

**IN SCOPE:**
- Storage functional object discovery
- Recursive metadata enumeration (bounded)
- Object properties: name, type, size, timestamps
- Storage properties: capacity, filesystem, serial
- Deterministic SHA-256 inventory digest

**OUT OF SCOPE:**
- File content streams (never opened)
- File copy/upload/preview (never performed)
- Private app data (never accessed)
- Write operations (never requested)

## Bounds

- MAX_SCAN_OBJECTS: 10,000
- MAX_SCAN_DEPTH: 5
- MAX_SCAN_DURATION_SECS: 30
- MAX_SCAN_ERRORS: 100

## Privacy Contract

- Read-only: GENERIC_READ access
- Metadata-only: no content streams
- Per-object error isolation
- Deterministic: same device → same digest

## Implementation

File: apps/desktop/src-tauri/src/wpd/scanner.rs

Key functions:
- scan_device_metadata() — main entry
- enumerate_objects_recursive() — bounded recursion
- query_storage_properties() — storage metadata
- query_object_metadata() — object metadata
- compute_inventory_digest() — SHA-256 digest

## IPC

Tauri command: scan_wpd_device_metadata
- Input: session_device_id
- Output: WpdScanResult

## Tests

Unit: 5 tests (bounds, determinism, digest)
Hardware: 1 test (Samsung A10s, requires --ignored)

## Hardware Validation

Validated: Samsung Galaxy A10s (VID_04E8&PID_6860)
- Device opens with GENERIC_READ
- Storage enumerated (1 storage found)
- Objects scanned (138 objects enumerated)
- Digest: bf8769f41d7bad7ae9d347d7d965414a4c49528eef78f6d6023ac8bd910a5c40
- Determinism verified (two scans produce identical digest)
- Depth bound hit honestly reported (WPD_SCAN_BOUNDS_DEPTH)
- No content streams opened

## Evidence V2

Source: WINDOWS_WPD_MTP
- Attribution preserved
- Digest for integrity
- Limitations reported honestly
- No fabrication of unavailable data
