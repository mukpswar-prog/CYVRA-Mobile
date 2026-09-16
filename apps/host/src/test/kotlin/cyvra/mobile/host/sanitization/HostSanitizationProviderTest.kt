package cyvra.mobile.host.sanitization

import cyvra.mobile.core.AuthorizationRequirement
import cyvra.mobile.core.BatteryEvidence
import cyvra.mobile.core.CapabilityProfile
import cyvra.mobile.core.CapabilityStatus
import cyvra.mobile.core.DeviceCapabilityAssessment
import cyvra.mobile.core.DeviceCapabilityItem
import cyvra.mobile.core.DeviceIdentifierRecord
import cyvra.mobile.core.DeviceIdentityEvidence
import cyvra.mobile.core.EvidenceFieldResult
import cyvra.mobile.core.EvidenceStatus
import cyvra.mobile.core.GenericDeviceEvidence
import cyvra.mobile.core.PreSanitizationRecord
import cyvra.mobile.core.RequiredAccessTier
import cyvra.mobile.core.SanitizationMethodType
import cyvra.mobile.core.SanitizationVerificationStatus
import cyvra.mobile.core.SecurityEvidence
import cyvra.mobile.core.StorageEvidence
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class HostSanitizationProviderTest {

    private fun createMockAdbClient(): AdbClient {
        val runner = ProcessRunner { _, _ -> DefaultProcessExecutionResult(0, "Success\n", "") }
        return AdbClient(File("/mock/adb"), runner)
    }

    private fun createSamplePreRecord(isAuthorized: Boolean): PreSanitizationRecord {
        val dummyField = EvidenceFieldResult("test", EvidenceStatus.AVAILABLE, "ADB")
        val dummyIdRecord = DeviceIdentifierRecord("IMEI", null, "ADB", "DEVICE", EvidenceStatus.RESTRICTED)
        val identity = DeviceIdentityEvidence(
            manufacturer = dummyField,
            brand = dummyField,
            model = dummyField,
            device = dummyField,
            product = dummyField,
            buildId = dummyField,
            androidVersion = dummyField,
            apiLevel = EvidenceFieldResult(34, EvidenceStatus.AVAILABLE, "ADB"),
            securityPatch = dummyField,
            platformIdentifier = dummyField,
            hardwareSerial = dummyIdRecord,
            imei = dummyIdRecord,
        )
        val storage = StorageEvidence(
            internalTotalBytes = EvidenceFieldResult(128000000000L, EvidenceStatus.AVAILABLE, "ADB"),
            internalAvailableBytes = EvidenceFieldResult(64000000000L, EvidenceStatus.AVAILABLE, "ADB"),
            externalStoragePresent = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
            scopedStorageEnforced = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
        )
        val battery = BatteryEvidence(
            levelPercent = EvidenceFieldResult(85, EvidenceStatus.AVAILABLE, "ADB"),
            isCharging = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
            health = EvidenceFieldResult("GOOD", EvidenceStatus.AVAILABLE, "ADB"),
            stateOfHealthSoh = EvidenceFieldResult(null, EvidenceStatus.RESTRICTED, "ADB"),
        )
        val assessment = DeviceCapabilityAssessment(
            manufacturer = "Samsung",
            model = "SM-S918B",
            apiLevel = 34,
            isOemAdapterAvailable = false,
            resolvedOemAdapter = null,
            capabilities = listOf(
                DeviceCapabilityItem(
                    capabilityKey = "PLATFORM_FACTORY_RESET",
                    displayName = "Platform Factory Reset",
                    status = CapabilityStatus.SUPPORTED,
                    requiredTier = RequiredAccessTier.L2_HOST_ADB,
                    isAvailable = true,
                ),
            ),
            recommendedPurgeAction = "PLATFORM_FACTORY_RESET",
        )

        val auth = AuthorizationRequirement(
            operationId = "OP-TEST-001",
            requiresOperatorConfirmation = true,
            confirmationPhrase = "AUTHORIZE OP-TEST-001",
            isAuthorized = isAuthorized,
            authorizedBy = if (isAuthorized) "Operator" else null,
        )

        return PreSanitizationRecord(
            operationId = "OP-TEST-001",
            sessionUuid = "SESS-001",
            identity = identity,
            storageSnapshot = storage,
            batterySnapshot = battery,
            selectedMethod = SanitizationMethodType.CLEAR_PLATFORM_RESET,
            capabilityAssessment = assessment,
            authorization = auth,
            operatorId = "Operator-1",
        )
    }

    @Test
    fun rejectsExecutionWhenUnauthorized() {
        val client = createMockAdbClient()
        val provider = HostSanitizationProvider(client, "serial-123")
        val preRecord = createSamplePreRecord(isAuthorized = false)

        val result = provider.execute(preRecord, dryRunOnly = true)
        assertFalse(result.isSuccess)
        assertEquals("FAILED_UNAUTHORIZED", result.executionStatus)
    }

    @Test
    fun executesDryRunSafelyWhenAuthorized() {
        val client = createMockAdbClient()
        val provider = HostSanitizationProvider(client, "serial-123")
        val preRecord = createSamplePreRecord(isAuthorized = true)

        val result = provider.execute(preRecord, dryRunOnly = true)
        assertTrue(result.isSuccess)
        assertEquals("SIMULATED_SUCCESS_G5_NON_DESTRUCTIVE", result.executionStatus)
    }

    @Test
    fun verifiesPostResetStateAccurately() {
        val client = createMockAdbClient()
        val verifier = HostVerificationProvider(client, "serial-123")

        // Case 1: Post-reboot evidence absent
        val pendingResult = verifier.verifyPostReset("OP-001", "SESS-001", null)
        assertEquals(SanitizationVerificationStatus.REQUIRES_EXTERNAL_VERIFICATION, pendingResult.status)
        assertFalse(pendingResult.postResetStateDetected)

        // Case 2: Post-reboot evidence present with lock screen absent (setup wizard)
        val dummyField = EvidenceFieldResult("test", EvidenceStatus.AVAILABLE, "ADB")
        val dummyIdRecord = DeviceIdentifierRecord("IMEI", null, "ADB", "DEVICE", EvidenceStatus.RESTRICTED)
        val postEvidence = GenericDeviceEvidence(
            sessionUuid = "SESS-001",
            collectedAt = "2026-09-15T06:30:00Z",
            identity = DeviceIdentityEvidence(
                dummyField, dummyField, dummyField, dummyField, dummyField, dummyField,
                dummyField, EvidenceFieldResult(34, EvidenceStatus.AVAILABLE, "ADB"), dummyField, dummyField,
                dummyIdRecord, dummyIdRecord,
            ),
            battery = BatteryEvidence(
                EvidenceFieldResult(90, EvidenceStatus.AVAILABLE, "ADB"),
                EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
                EvidenceFieldResult("GOOD", EvidenceStatus.AVAILABLE, "ADB"),
                EvidenceFieldResult(null, EvidenceStatus.RESTRICTED, "ADB"),
            ),
            storage = StorageEvidence(
                EvidenceFieldResult(128000000000L, EvidenceStatus.AVAILABLE, "ADB"),
                EvidenceFieldResult(120000000000L, EvidenceStatus.AVAILABLE, "ADB"),
                EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
                EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
            ),
            security = SecurityEvidence(
                screenLockPresent = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"), // Absent = Setup Wizard
                secureBootEnabled = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
                deviceOwnerActive = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
                adbEnabled = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
                knoxClaim = EvidenceFieldResult(null, EvidenceStatus.RESTRICTED, "ADB"),
            ),
        )

        val verifiedResult = verifier.verifyPostReset("OP-001", "SESS-001", postEvidence)
        assertEquals(SanitizationVerificationStatus.VERIFIED, verifiedResult.status)
        assertTrue(verifiedResult.postResetStateDetected)
        assertTrue(verifiedResult.setupWizardDetected)
        assertTrue(verifiedResult.userDataInaccessible)
    }
}
