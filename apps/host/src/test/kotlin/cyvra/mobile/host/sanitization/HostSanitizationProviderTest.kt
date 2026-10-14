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
import cyvra.mobile.host.security.HostSecurityAuditEngine
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
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

    /**
     * The post-reboot evidence fixture, shared by every test in this class so the
     * block is not duplicated. Assertions are unchanged from where it was inlined.
     */
    private fun postResetEvidence(): GenericDeviceEvidence {
        val dummyField = EvidenceFieldResult("test", EvidenceStatus.AVAILABLE, "ADB")
        val dummyIdRecord = DeviceIdentifierRecord("IMEI", null, "ADB", "DEVICE", EvidenceStatus.RESTRICTED)
        return GenericDeviceEvidence(
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
                screenLockPresent = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
                secureBootEnabled = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
                deviceOwnerActive = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
                adbEnabled = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
                knoxClaim = EvidenceFieldResult(null, EvidenceStatus.RESTRICTED, "ADB"),
            ),
        )
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
        val postEvidence = postResetEvidence()

        val verifiedResult = verifier.verifyPostReset("OP-001", "SESS-001", postEvidence)
        assertTrue(verifiedResult.postResetStateDetected)
        // Screen-lock absence is CONSISTENT with a post-reset OOBE state, so the
        // setup-wizard observation is recorded. It is one boolean, though, and a device
        // whose owner never set a lock presents identically - so it earns only
        // PARTIALLY_VERIFIED. This assertion previously required VERIFIED, which is the
        // exact claim the fix removed.
        assertTrue(verifiedResult.setupWizardDetected)
        assertEquals(
            SanitizationVerificationStatus.PARTIALLY_VERIFIED,
            verifiedResult.status,
        )
        // null = NOT ESTABLISHED. The old assertion here was assertTrue, encoding the
        // fabrication: user-data inaccessibility was inferred from screen-lock state.
        assertNull(verifiedResult.userDataInaccessible)
        // The assurance level must not name a standard this product has not executed.
        assertFalse(
            verifiedResult.assuranceLevel.contains("NIST"),
            "assurance must describe what was observed, not cite an unexecuted standard",
        )
        assertTrue(
            verifiedResult.limitations.any { it.contains("does not establish erasure") },
            "the limitations must state what this check cannot prove",
        )
    }

    // ------------------------------------------------------------------ PUR-006

    @Test
    fun takesResidualInventoryThroughSupportedPaths() {
        val allPackages =
            "package:android\n" +
                "package:com.android.settings\n" +
                "package:com.alpha\n" +
                "package:com.cyvra.demo\n"
        val runner = ProcessRunner { command, _ ->
            val cmd = command.joinToString(" ")
            when {
                cmd.contains("pm list packages -3") ->
                    DefaultProcessExecutionResult(0, "package:com.alpha\npackage:com.cyvra.demo\n", "")
                cmd.contains("pm list packages") ->
                    DefaultProcessExecutionResult(0, allPackages, "")
                else -> DefaultProcessExecutionResult(0, "Success\n", "")
            }
        }
        val verifier = HostVerificationProvider(AdbClient(File("/mock/adb"), runner), "serial-123")
        val result = verifier.verifyPostReset("OP-001", "SESS-001", postResetEvidence())

        assertEquals(4, result.residualTotalPackages)
        assertEquals(2, result.residualThirdPartyPackages)
        assertEquals(1, result.residualCyvraPackages)
        assertNotNull(result.notes)
        assertTrue(
            result.notes!!.contains("total=4"),
            "the measured counts must be published on the result",
        )
        assertTrue(
            result.limitations.any { it.contains("PUR-006") && it.contains("measured after reset") },
            "the residual scan must be reported as measured, with its scope stated",
        )
        // The scope limit must survive: applications are counted, user data is not.
        assertTrue(
            result.limitations.any { it.contains("remain unmeasured") },
            "account/contact/media coverage must still be declined rather than implied",
        )
    }

    @Test
    fun reportsAnUnreadableEnumerationAsNotMeasuredRatherThanZero() {
        // The command succeeds but yields no package records. Publishing 0 here would
        // claim "no packages installed", which an unreadable listing does not support.
        val runner = ProcessRunner { _, _ -> DefaultProcessExecutionResult(0, "Success\n", "") }
        val verifier = HostVerificationProvider(AdbClient(File("/mock/adb"), runner), "serial-123")
        val result = verifier.verifyPostReset("OP-001", "SESS-001", postResetEvidence())

        assertNull(result.residualTotalPackages)
        assertNull(result.residualThirdPartyPackages)
        assertNull(result.residualCyvraPackages)
        assertTrue(
            result.limitations.any { it.contains("PUR-006") && it.contains("was NOT measured") },
            "an unreadable enumeration must be disclosed, not reported as a count",
        )
        assertNull(result.userDataInaccessible)
    }

    @Test
    fun reportsAFailedEnumerationAsNotMeasured() {
        val runner = ProcessRunner { _, _ -> DefaultProcessExecutionResult(1, "", "permission denied") }
        val verifier = HostVerificationProvider(AdbClient(File("/mock/adb"), runner), "serial-123")
        val result = verifier.verifyPostReset("OP-001", "SESS-001", postResetEvidence())

        assertNull(result.residualTotalPackages)
        assertNull(result.residualThirdPartyPackages)
        assertTrue(
            result.limitations.any { it.contains("was NOT measured") && it.contains("failed") },
            "a failed enumeration must be disclosed as not measured",
        )
    }

    @Test
    fun residualCommandsStayInsideTheSupportedSet() {
        // This is the boundary that keeps PUR-006 partial: packages are inside the
        // supported command set, and the user-data sources are not.
        val security = HostSecurityAuditEngine()
        assertTrue(security.validateAdbCommandSafety("pm list packages"))
        assertTrue(security.validateAdbCommandSafety("pm list packages -3"))
        assertFalse(
            security.validateAdbCommandSafety("content query --uri content://contacts/contacts"),
            "contacts are outside the supported set, which is why they stay unmeasured",
        )
        assertFalse(
            security.validateAdbCommandSafety("dumpsys account"),
            "accounts are outside the supported set, which is why they stay unmeasured",
        )
    }
}
