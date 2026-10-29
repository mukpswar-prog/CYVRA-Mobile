# CYVRA Mobile — Step C Sanitization Verification Report

**Execution date:** 2026-10-29  
**Target:** Samsung Galaxy A10s (`SM-A107F`), Android 11 / API 30  
**Handset serial:** `R9BN3015NQJ`  
**Device Lifecycle ID:** `R9BN3015NQJ-8202f52d`  
**Operator:** `OP-BENCH-01`

> **Record provenance and limitation:** This Markdown record summarizes the Step C report text supplied in the project conversation. The original 29 October sanitization PDF, certificate files, and raw post-reset evidence were not available in the workspace when this file was prepared. The reported wipe is treated as already executed; this record does not authorize or request another wipe.

## Reported execution

The supplied report states that an explicitly authorized physical factory reset was executed on the Samsung Galaxy A10s and that the physical wipe count is 1.

The reported sequence included:

1. Device Owner active before sanitization.
2. An `ARM` then `WIPE` flow.
3. A single-use 256-bit token bound to the session, serial, and operation, with a reported 60-second TTL.
4. Invocation of `DevicePolicyManager.wipeData(0)`.
5. Reboot/recovery activity reported as `reboot,factory_reset`.
6. Post-reset checks reporting zero accounts, `deviceLocked=0`, the CYVRA agent/app absent, and CYVRA Device Owner cleared.

The supplied report listed four remaining package IDs and characterized them as OEM preloads. The excerpt available for this record did not include package flags or partition paths sufficient to independently confirm that classification.

## Reported certificate artifacts

- PDF: `CYVRA_003_R9BN3015NQJ-3d982c89_SANITIZATION_AUDIT_20261029-150304.pdf`
- Reported PDF SHA-256: `6c497e87d8fc8e20573a61e2f618f3a96ce5731309875e0cdab4b1de3ab45188`
- Certificate directory: `C:\ProgramData\CYVRA Mobile\certificates\CYVRA-CERT-2026-DACB22\`
- Reported files: `certificate.json`, `certificate.md`, and `manifest.json`

The original files were not present to verify their contents, hashes, signatures, or sealing state.

## Assurance wording

A factory reset and observed post-reset checks can support a report of the method executed and the evidence observed. They do not, without additional method-specific evidence, establish forensic proof that every storage cell was overwritten or that all data is irrecoverable. Any customer-facing certificate should state the actual method and observed verification results, and should not overstate the assurance level.

## Required evidence follow-up

- Preserve the original PDF, certificate JSON/Markdown, manifest, and raw post-reset command outputs.
- Recompute and record hashes from the actual files.
- Confirm the remaining package classification using package flags and installation paths.
- Keep the reported execution record immutable; do not repeat sanitization as part of documentation work.
