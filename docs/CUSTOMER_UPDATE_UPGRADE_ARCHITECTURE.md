# Customer Desktop Update & Upgrade Architecture

**Reference:** [CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md](./CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md) §7, §74

---

## 1. Distinct Concepts: UPDATE vs UPGRADE

The Windows desktop header provides two visually distinct actions:

### A. [ UPDATE ] (Software Maintenance)
- **Purpose:** Updates the installed Windows desktop binary, embedded Platform-Tools, and diagnostic engine to the latest approved release.
- **Workflow:** Background version check → Download signed delta package → SHA-256 signature verification → Staged installation on exit/restart.
- **State Display:** `✓ CYVRA Mobile is up to date (Version 3.2.1)` or `Update Available (v3.3.0) [Update Now]`.

### B. [ UPGRADE ] (Entitlement Expansion)
- **Purpose:** Expands commercial device scan allowances or operator seat tiers (e.g. from 3 scans to 25 scans).
- **Workflow:** Directs operator to authenticated web checkout handoff (`https://www.cyvoriq.co.in/upgrade`) → Outside desktop core payment → Server creates new entitlement revision → Desktop detects return / triggers refresh → License display automatically updates remaining scans.
- **Safety:** Desktop client never collects or handles raw payment cards.
