package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Entitlement and license status per Customer Desktop Freeze §14 and Master Workflow §29.
 */
@Serializable
enum class LicenseEntitlementStatus {
    ACTIVE,
    EXPIRED,
    REVOKED,
    SUPERSEDED,
    UNKNOWN,
    SERVER_UNAVAILABLE,
}

/**
 * Detailed license entity preserving immutable license_id and revision history (§13).
 */
@Serializable
data class CustomerLicenseRecord(
    val licenseId: String,               // Immutable e.g. LIC-MOB-2026-00124
    val serialNumber: String,           // Parseable public key e.g. CYVRA15092026SA3F1-1-25
    val customerEmail: String,
    val customerName: String? = null,
    val companyName: String? = null,
    val planName: String,               // e.g. "25 Device Scans"
    val deviceScanEntitlement: Int,     // Total scans purchased (1, 3, 5, 7, 25)
    val scansUsed: Int,                 // Number of completed scans
    val scansRemaining: Int,            // Entitlement balance
    val revision: Int = 1,              // Incremented on upgrade (Revision 1 -> Revision 2)
    val status: LicenseEntitlementStatus = LicenseEntitlementStatus.ACTIVE,
    val validFrom: String? = null,
    val validUntil: String? = null,
    val lastVerifiedAt: String = java.time.Instant.now().toString(),
)

/**
 * Scan consumption event following §14 (committed at start, finalized upon report).
 */
@Serializable
enum class ScanCommitStatus {
    COMMITTED,
    VERIFIED_AND_DEBITED,
    CANCELLED_PRE_FLIGHT,
    REFUNDED_ON_ERROR,
}

@Serializable
data class DeviceScanTransaction(
    val transactionId: String,
    val licenseId: String,
    val sessionUuid: String,
    val deviceIdentifier: String,
    val committedAt: String = java.time.Instant.now().toString(),
    val status: ScanCommitStatus = ScanCommitStatus.COMMITTED,
    val debitedScanNumber: Int,
)

/**
 * Device connection status models for the workstation UI and transport state machine.
 */
@Serializable
enum class HostWorkstationConnectionStatus {
    DISCONNECTED,
    USB_DETECTED,
    ADB_UNAUTHORIZED,
    ADB_OFFLINE,
    READY_TO_SCAN,
    DEVICE_SCANNING,
    RECONNECTING,
}

@Serializable
data class WorkstationDeviceDescriptor(
    val serial: String,
    val manufacturer: String? = null,
    val model: String? = null,
    val androidVersion: String? = null,
    val apiLevel: Int? = null,
    val connectionStatus: HostWorkstationConnectionStatus,
    val usbState: String,
    val adbState: String,
    val operatorGuidance: String? = null,
    val activeSessionUuid: String? = null,
)
