# Customer Report Architecture

**Status:** ACTIVE CONTRACT
**Date:** 2026-09-19

## Report types

### Report 1

**CYVRA Device Verification Report**

Pre-sanitization verification/evidence report.

It does not prove sanitization.

### Sanitization outcome

A successful **CYVRA Data Sanitization & Verification Certificate** is issued only after an authorized, qualified method and accepted validation.

Otherwise produce a sanitization attempt/verification report with limitations.

## One canonical manifest

Target architecture:

```text
immutable evidence
        ↓
canonical report manifest
        ↓
canonical SHA-256 digest
        ├─ JSON
        ├─ PDF
        └─ cloud registry
```

JSON, PDF, web, and Markdown are renderings of the same canonical manifest.

They are not competing sources of truth.

## Evidence binding

Evidence V2 report entries bind at least:

```text
fact/test identity
evidenceId
evidence digest
source
result/status
```

Historical V1 reports remain readable.

## Workstation/cloud ownership

The workstation owns observed-device evidence and freezes the canonical local manifest.

The cloud validates/records the same manifest and account/entitlement association.

The cloud must not silently reconstruct a materially different report.

## Integrity

SHA-256 digest proves content integrity, not signer identity.

Digital signing, if introduced, requires a separate controlled key-management design.

Do not place a long-lived private signing key on every customer workstation merely to hash a report.

## Coverage

`COMPLETE`, `LIMITED`, and `PARTIAL` describe evidence completeness, not device quality.

## Report immutability

Once Report 1 is frozen, later sanitization does not rewrite it.

The final sanitization report references the pre-sanitization report/evidence instead.
