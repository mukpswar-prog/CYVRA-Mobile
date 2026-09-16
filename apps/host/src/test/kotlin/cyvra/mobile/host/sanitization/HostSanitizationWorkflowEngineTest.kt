package cyvra.mobile.host.sanitization

import cyvra.mobile.core.AuthorizationRequirement
import cyvra.mobile.core.BatteryEvidence
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
import cyvra.mobile.core.SanitizationWorkflowStep
import cyvra.mobile.core.SecurityEvidence
import cyvra.mobile.core.StorageEvidence
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HostSanitizationWorkflowEngineTest {

    private fun createMockAdbClient(): AdbClient {
        val runner = ProcessRunner { _, _ -> DefaultProcessExecutionResult(0, "Success\n", "") }
        return AdbClient(File("/mock/adb"), runner)
    }

    private fun createSampleEvidence(screenLockPresent: Boolean = true): GenericDeviceEvidence {
        val dummyField = EvidenceFieldResult("test", EvidenceStatus.AVAILABLE, "ADB")
        val dummyId = DeviceIdentifierRecord("ID", "VAL", "ADB", "DEV", EvidenceStatus.AVAILABLE)
        return GenericDeviceEvidence(
            sessionUuid = "SESS-100",
            collectedAt = "2026-09-15T12:00:00Z",
            identity = DeviceIdentityEvidence(
                manufacturer = EvidenceFieldResult("Google", EvidenceStatus.AVAILABLE, "ADB"),
                brand = dummyField,
                model = EvidenceFieldResult("Pixel 8", EvidenceStatus.AVAILABLE, "ADB"),
                device = dummyField,
                product = dummyField,
                buildId = dummyField,
                androidVersion = dummyField,
                apiLevel = EvidenceFieldResult(34, EvidenceStatus.AVAILABLE, "ADB"),
                securityPatch = dummyField,
                platformIdentifier = dummyField,
                hardwareSerial = dummyId,
                imei = dummyId,
            ),
            battery = BatteryEvidence(
                levelPercent = EvidenceFieldResult(85, EvidenceStatus.AVAILABLE, "ADB"),
                isCharging = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
                health = EvidenceFieldResult("GOOD", EvidenceStatus.AVAILABLE, "ADB"),
                stateOfHealthSoh = EvidenceFieldResult(null, EvidenceStatus.RESTRICTED, "ADB"),
            ),
            storage = StorageEvidence(
                internalTotalBytes = EvidenceFieldResult(128000000000L, EvidenceStatus.AVAILABLE, "ADB"),
                internalAvailableBytes = EvidenceFieldResult(120000000000L, EvidenceStatus.AVAILABLE, "ADB"),
                externalStoragePresent = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
                scopedStorageEnforced = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
            ),
            security = SecurityEvidence(
                screenLockPresent = EvidenceFieldResult(screenLockPresent, EvidenceStatus.AVAILABLE, "ADB"),
                secureBootEnabled = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
                deviceOwnerActive = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
                adbEnabled = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
                knoxClaim = EvidenceFieldResult(null, EvidenceStatus.RESTRICTED, "ADB"),
            ),
        )
    }

    private fun createSampleAssessment(): DeviceCapabilityAssessment {
        return DeviceCapabilityAssessment(
            manufacturer = "Google",
            model = "Pixel 8",
            apiLevel = 34,
            isOemAdapterAvailable = false,
            resolvedOemAdapter = null,
            recommendedPurgeAction = "PLATFORM FACTORY RESET",
            isPostPurgeVerificationRequired = true,
            capabilities = listOf(
                DeviceCapabilityItem(
                    capabilityKey = "PLATFORM_FACTORY_RESET",
                    displayName = "Standard Platform Factory Reset",
                    status = CapabilityStatus.SUPPORTED,
                    requiredTier = RequiredAccessTier.L2_HOST_ADB,
                    isAvailable = true,
                )
            ),
        )
    }

    @Test
    fun preventsExecutionWithoutSatisfying2StepConfirmationBarrier() {
        val client = createMockAdbClient()
        val provider = HostSanitizationProvider(client, "TEST-DEVICE-01")
        val verifier = HostVerificationProvider(client, "TEST-DEVICE-01")
        val workflowEngine = HostSanitizationWorkflowEngine(provider, verifier)

        val assessment = createSampleAssessment()
        var session = workflowEngine.initializeSession("SESS-100", "TEST-DEVICE-01", assessment)

        assertEquals(SanitizationWorkflowStep.AUTHORIZATION_REQUIRED, session.currentStep)
        assertFalse(session.barrier.isBarrierPassed)

        val evidence = createSampleEvidence()
        val preRecord = PreSanitizationRecord(
            operationId = session.operationId,
            sessionUuid = session.sessionUuid,
            identity = evidence.identity,
            storageSnapshot = evidence.storage,
            batterySnapshot = evidence.battery,
            selectedMethod = session.selectedMethod,
            capabilityAssessment = assessment,
            authorization = AuthorizationRequirement(
                operationId = session.operationId,
                requiresOperatorConfirmation = true,
                confirmationPhrase = session.barrier.step2PhraseRequired,
                isAuthorized = false,
            ),
            operatorId = "operator@cyvoriq.com",
        )

        // Attempt execution while barrier not passed
        val failedExecution = workflowEngine.executePurge(session, preRecord, dryRunOnly = true)
        assertEquals(SanitizationWorkflowStep.FAILED, failedExecution.currentStep)
        assertTrue(failedExecution.failureReason?.contains("2-step operator confirmation barrier") == true)
    }

    @Test
    fun executesPurgeAndVerifiesPostResetReconnection() {
        val client = createMockAdbClient()
        val provider = HostSanitizationProvider(client, "TEST-DEVICE-01")
        val verifier = HostVerificationProvider(client, "TEST-DEVICE-01")
        val workflowEngine = HostSanitizationWorkflowEngine(provider, verifier)

        val assessment = createSampleAssessment()
        var session = workflowEngine.initializeSession("SESS-100", "TEST-DEVICE-01", assessment)

        // Step 1: Check acknowledgement
        session = workflowEngine.toggleStep1Acknowledgement(session, true)
        assertTrue(session.barrier.step1AcknowledgementChecked)

        // Step 2: Submit matching confirmation phrase
        session = workflowEngine.submitStep2Confirmation(
            session = session,
            phrase = session.barrier.step2PhraseRequired,
            operatorId = "operator@cyvoriq.com",
        )
        assertTrue(session.barrier.isBarrierPassed)
        assertEquals(SanitizationWorkflowStep.CONFIRMATION_PASSED, session.currentStep)

        // Method selection
        session = workflowEngine.selectMethod(session, SanitizationMethodType.CLEAR_PLATFORM_RESET)
        assertEquals(SanitizationWorkflowStep.METHOD_SELECTED, session.currentStep)

        // Execute purge (dry-run safe under G5)
        val evidence = createSampleEvidence()
        val preRecord = PreSanitizationRecord(
            operationId = session.operationId,
            sessionUuid = session.sessionUuid,
            identity = evidence.identity,
            storageSnapshot = evidence.storage,
            batterySnapshot = evidence.battery,
            selectedMethod = session.selectedMethod,
            capabilityAssessment = assessment,
            authorization = AuthorizationRequirement(
                operationId = session.operationId,
                requiresOperatorConfirmation = true,
                confirmationPhrase = session.barrier.step2PhraseRequired,
                isAuthorized = true,
                authorizedBy = "operator@cyvoriq.com",
            ),
            operatorId = "operator@cyvoriq.com",
        )

        session = workflowEngine.executePurge(session, preRecord, dryRunOnly = true)
        assertEquals(SanitizationWorkflowStep.RECONNECT_AWAITING, session.currentStep)
        assertTrue(session.executionResult?.isSuccess == true)

        // Simulate post-reset device reconnection (screen lock absent -> Setup Wizard / OOBE state)
        val postRebootEvidence = createSampleEvidence(screenLockPresent = false)
        session = workflowEngine.verifyReconnection(session, "TEST-DEVICE-01", postRebootEvidence)

        assertEquals(SanitizationWorkflowStep.CERTIFICATION_READY, session.currentStep)
        assertTrue(session.reconnectionState?.setupWizardDetected == true)
        assertTrue(session.reconnectionState?.userAccountsRemoved == true)
        assertTrue(session.verificationResult?.userDataInaccessible == true)
    }
}
