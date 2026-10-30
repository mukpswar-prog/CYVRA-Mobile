# CYVRA Mobile — Step A Verification Report

**Execution date:** 2026-10-29  
**Target:** Samsung Galaxy A10s (`SM-A107F`), Android 11 / API 30  
**Handset serial:** `R9BN3015NQJ`  
**Operator:** `OP-BENCH-01`  
**Session UUID:** `8202f52d-0071-4ca8-bdca-d7b7f09d508a`

> **Record provenance:** This Markdown record is transcribed from the Step A report text supplied in the project conversation. The original 29 October PDF and raw evidence bundle were not available in the workspace when this file was prepared. Values below are reported observations, not independently re-verified by this document.

## Reported outcome

The operator report marked Step A complete. It described USB/ADB connectivity, an authorized ADB session, active Device Owner, zero accounts, `HOST_FALLBACK_READY`, `SANITIZATION_CAPABILITY_READY`, and an offline entitlement with 10 available scans.

The scan reportedly collected a 48-parameter hardware profile and a dual-source application inventory.

## Reported device profile

- SoC identifier: `mt6765` / Helio P22
- CPU: 8 cores, reported maximum 1.75 GHz
- RAM: 1.83 GB
- Data partition: 24.7 GB
- Display: 720 × 1520
- Cameras: 3
- Sensors: accelerometer, proximity, and light
- Connectivity: Wi-Fi, Bluetooth, telephony, and GNSS
- Android: 11; reported security patch: `2022-09-01`
- Reported build ID: `RP1A.200720.012`
- Reported Verified Boot state: orange
- SD card: absent
- IMEI, persistent serial, Knox warranty, and battery state of health: restricted or unavailable

## Reported application inventory

- Total packages: 334
- System packages: 329
- User/third-party packages: 5
- Enabled packages: 333
- Disabled packages: 1

Inventory was described as metadata-only.

## Reported artifacts

- Hardware report: `CYVRA_001_R9BN3015NQJ-8202f52d_HW_SCAN_20261029-083608.pdf`
- Application report: `CYVRA_002_R9BN3015NQJ-8202f52d_APP_SCAN_20261029-083610.pdf`

The Step A text supplied a hardware-report SHA-256 of `c050a2cdd1e78c41250f4dce61b24f18f056a229d34da6d19c638d1d0ee6f52c`. A later master report supplied a different digest for the same named hardware report. The digest discrepancy remains unresolved and must be checked against the original files before relying on either value. Application-report hashes also differ between the Step A and master records.

## Reconciliation items

The Step A values for SoC/clock, patch level, build ID, and Verified Boot state differ from the later Step B and master reports. Do not merge these into one canonical device profile without the original session evidence and PDF files. Preserve the values as recorded for this execution and reconcile them against raw command output and artifact hashes.
