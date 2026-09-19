# Customer Diagnostic UX

**Status:** ACTIVE UX CONTRACT
**Date:** 2026-09-19

## Goal

The customer UI must explain what the workstation actually sees without forcing the operator to understand Windows device APIs, MTP, or ADB internals.

## Main device card

Present independent connection indicators:

```text
USB        PRESENT / NOT PRESENT / UNKNOWN
MTP/WPD    AVAILABLE / UNAVAILABLE / UNKNOWN
ADB        UNAVAILABLE / UNAUTHORIZED / OFFLINE / READY
Component  AVAILABLE / UNAVAILABLE / RESTRICTED
```

Do not compress these into one green/red "connected" light.

## Discovery

Before a verification starts, the UI may passively:

- observe USB;
- enumerate WPD/MTP devices;
- show safe descriptive metadata;
- estimate available verification paths.

This must not consume a licensed scan.

## Multiple devices

If more than one plausible device is attached:

- show candidates;
- do not pick the first device silently;
- require explicit selection when correlation is insufficient;
- bind the selected device to a session-scoped reference.

## ADB guidance

If ADB is unavailable, continue with available USB/WPD evidence.

If ADB is unauthorized, explain that Android requires user authorization. Do not guide around the RSA prompt.

## Verification

After explicit `Start Device Verification`:

```text
transaction reservation
        ↓
independent collectors
        ↓
limitations shown as collected
        ↓
canonical Report 1 freeze
        ↓
consumption finalization
```

Collector failure must not crash the complete verification.

## Honesty presentation

Use explicit states such as:

```text
Available
Not available
Restricted by Android
Permission required
Not supported
Not tested
Error
```

Do not show placeholders as measured facts.

## Report

Report 1 is the **CYVRA Device Verification Report**.

It is not a sanitization certificate.

Coverage labels describe evidence completeness, not device quality.

## Sanitization navigation

Sanitization is a separate workspace with separate warnings and authorization.

A verification result must never imply the destructive action is already authorized.
