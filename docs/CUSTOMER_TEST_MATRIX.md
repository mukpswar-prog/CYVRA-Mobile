# Customer Workflow Acceptance Matrix

**Status:** ACTIVE PRODUCT ACCEPTANCE REFERENCE
**Date:** 2026-09-19

## Purpose

These tests prove the operator-facing product lifecycle. Engineering unit tests alone do not satisfy this matrix.

## Host acceptance

| ID | Scenario | Expected |
|---|---|---|
| UX-HOST-001 | clean Windows 10 x64 | install/launch without developer tooling |
| UX-HOST-002 | clean Windows 11 x64 | install/launch without developer tooling |
| UX-HOST-003 | update | signed/verified update; rollback/failure handled |
| UX-HOST-004 | uninstall | expected data/config retention policy |

## Device discovery

| ID | Scenario | Expected |
|---|---|---|
| UX-DEV-001 | USB only | device card shows USB truth |
| UX-DEV-002 | USB + MTP, no ADB | verification path remains available |
| UX-DEV-003 | ADB unauthorized | user guidance; no bypass |
| UX-DEV-004 | ADB offline | separate state; no false disconnect |
| UX-DEV-005 | two devices | explicit disambiguation; no first-device default |
| UX-DEV-006 | disconnect/reconnect | safe state recovery |

## Verification/licensing

| ID | Scenario | Expected |
|---|---|---|
| UX-LIC-001 | passive discovery | no scan consumed |
| UX-LIC-002 | start verification | transaction reserved |
| UX-LIC-003 | collector limitation | report stays honest/partial |
| UX-LIC-004 | report freeze | transaction consumed once |
| UX-LIC-005 | report replay/retry | no double charge |

## Report

| ID | Scenario | Expected |
|---|---|---|
| UX-RPT-001 | Report 1 | canonical ID/digest and limitations visible |
| UX-RPT-002 | missing restricted ID | explicit restriction, no placeholder |
| UX-RPT-003 | print/PDF | rendering matches canonical manifest |
| UX-RPT-004 | offline then sync | local evidence collection time preserved |

## Sanitization

| ID | Scenario | Expected |
|---|---|---|
| UX-SAN-001 | unqualified method | unavailable/unsupported |
| UX-SAN-002 | confirmation step 1 missing | execution blocked |
| UX-SAN-003 | target changes | authorization stale/blocked |
| UX-SAN-004 | simulation | never certificate-ready |
| UX-SAN-005 | expected reboot | workflow enters reconnect state |
| UX-SAN-006 | ADB absent post-reset | USB/WPD/operator verification path |
| UX-SAN-007 | identity mismatch | no certificate |
| UX-SAN-008 | verification inconclusive | external-review outcome |
| UX-SAN-009 | accepted qualified method | certificate generated |

## Accessibility and clarity

Test:

- clear error/limitation language;
- keyboard operation for core flows;
- no critical status conveyed by color alone;
- destructive confirmation is unmistakable;
- offline/network errors are not reported as device failures.

## Release rule

All applicable customer acceptance rows must have recorded evidence on the release candidate before the corresponding capability is advertised as release-supported.
