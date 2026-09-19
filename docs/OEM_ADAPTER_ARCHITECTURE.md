# OEM Adapter Architecture

**Status:** ACTIVE CONTRACT
**Date:** 2026-09-19

## Decision

CYVRA Mobile is generic-core-first.

```text
generic platform capability
        ↓
device-specific observation
        ↓
OEM adapter only when required and proven
```

Unknown OEM must not fail merely because no proprietary adapter exists.

## Permanent rules

- Do not create empty OEM stubs.
- Do not unlock behavior from a model-name switch.
- Do not label an OEM capability supported until it is hardware-proven.
- Do not use Knox/UEM/device-owner authority unless the deployment legitimately has that authority.
- Keep OEM-specific code isolated from generic evidence and transport logic.
- Unsupported OEM behavior is reported as a limitation, not fabricated.

## Interface boundary

Current model includes an `OemAdapter` abstraction and capability resolver in the Kotlin core/domain layer.

A production adapter should expose only explicitly qualified capabilities, for example:

```text
adapterId
OEM/family scope
software/firmware scope
capabilities
authority prerequisites
evidence methods
sanitization methods
limitations
qualification version
```

## Qualification

An adapter is not release-supported until the relevant capability is tested on physical hardware.

Test families may include Samsung, Xiaomi/Redmi/POCO, Motorola, OnePlus, OPPO/Realme, Vivo, Pixel, Nothing, HMD/Nokia, and unknown/generic devices.

This is a lab matrix, not a claim that all families are currently supported.

## Sanitization

OEM-specific sanitization is especially strict.

A brand-specific reset or erase may be offered only when:

- the actual OEM interface is known;
- the target model/software scope is qualified;
- required authority is legitimate;
- storage scope is understood;
- verification and validation criteria are defined;
- failure paths have been tested.

See [`SANITIZATION_ARCHITECTURE.md`](./SANITIZATION_ARCHITECTURE.md).

## Fallback

If no verified adapter matches:

```text
Generic Android / Windows evidence path
```

remains available where transport and permissions permit.

Generic fallback must never be described as OEM-certified.
