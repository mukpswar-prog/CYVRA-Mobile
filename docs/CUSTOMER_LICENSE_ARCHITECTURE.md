# Customer Desktop License & Entitlement Architecture

**Reference:** [CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md](./CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md) §2, §3, §74

---

## 1. Commercial Dimensions: Users vs Device Scans

CYVRA explicitly distinguishes:
1. **Licensed Device Scans:** The quantity of Android devices authorized to be processed under the entitlement (e.g. 3, 5, 7, 25 device scans). Device scans are never referred to as "users".
2. **Operator / User Seats:** The number of technician accounts permitted to access the workstation application.

---

## 2. Server-Authoritative Entitlement Revision Model

License upgrades do not destroy historical records. They advance an entitlement revision:

```text
License Identity: immutable license_id
       │
       ├── Revision 1: CYVRA-MOB-XXXX-001 (Plan: 3 Scans, Used: 2, Remaining: 1)
       │        ↓ (Customer purchases upgrade on web)
       └── Revision 2: CYVRA-MOB-XXXX-002 (Plan: 25 Scans, Used: 2, Remaining: 23)
                        [Status: ACTIVE, Revision 1 SUPERSEDED]
```

- **Database Identity:** `license_id` is the immutable primary key. Serial numbers are revision-specific tokens.
- **Accounting:** Device scan consumptions are decremented only upon completion of a successful report generation or authorized purge verification, preventing accidental burning of scans.
- **Offline Policy:** Cached cryptographic lease with grace period; network sync required periodically or upon license upgrade.
