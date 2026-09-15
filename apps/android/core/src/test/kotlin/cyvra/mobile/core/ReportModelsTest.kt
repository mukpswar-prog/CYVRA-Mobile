package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ReportModelsTest {

    private fun createSampleHeader(): ReportHeader {
        return ReportHeader(
            reportId = "CYVRA-R1-2026-TEST01",
            reportTitle = "CYVRA Device Verification Report",
            operatorId = "OPERATOR-42",
            sessionUuid = "SESS-1001",
        )
    }

    @Test
    fun serializesAndDeserializesReportHeader() {
        val header = createSampleHeader()
        val json = Json { prettyPrint = true; encodeDefaults = true }
        val serialized = json.encodeToString(header)

        assertTrue(serialized.contains("CYVRA-R1-2026-TEST01"))
        assertTrue(serialized.contains("CYVORIQ Solutions"))

        val decoded = json.decodeFromString<ReportHeader>(serialized)
        assertEquals("OPERATOR-42", decoded.operatorId)
        assertEquals("SESS-1001", decoded.sessionUuid)
    }

    @Test
    fun supportsReportIntegrityRecordWithSha256() {
        val integrity = ReportIntegrityRecord(
            algorithm = "SHA-256",
            contentDigest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            signatureBlockPresent = true,
        )
        val json = Json { prettyPrint = true; encodeDefaults = true }
        val serialized = json.encodeToString(integrity)

        assertTrue(serialized.contains("SHA-256"))
        assertTrue(serialized.contains("e3b0c442"))

        val decoded = json.decodeFromString<ReportIntegrityRecord>(serialized)
        assertEquals("SHA-256", decoded.algorithm)
        assertTrue(decoded.signatureBlockPresent)
    }

    @Test
    fun serializesAndDeserializesCyvoriqCertifiedConditionReport() {
        val gradingDecision = DeviceGradingDecisionRecord(
            gradingId = "GRADE-DEC-001",
            inspectionId = "INSP-001",
            sessionUuid = "SESS-1001",
            deviceIdentifier = "RF8R123456",
            safetyGrade = SafetyGrade.S0_SAFE_TO_PROCESS,
            cosmeticGrade = CosmeticGrade.B_LIGHT_WEAR,
            functionalGrade = FunctionalGrade.F0_FULLY_VERIFIED,
            overallGrade = OverallCertifiedGrade.GRADE_B,
            rulesVersion = "GRADE-IN-001",
            presentation = CountryGradingProfilePresentation(
                safetyLabel = "Safe to Process",
                cosmeticLabel = "Grade B - Light Wear",
                functionalLabel = "Fully Verified",
                overallLabel = "Grade B (Certified Good)",
            ),
            physicalFindingsSummary = listOf("2 light frame scratches", "no visible screen crack"),
        )

        val dummyField = EvidenceFieldResult("test", EvidenceStatus.AVAILABLE, "ADB")
        val dummyId = DeviceIdentifierRecord("SERIAL", "SERIAL123", "ADB", "DEVICE", EvidenceStatus.AVAILABLE)
        val identity = DeviceIdentityEvidence(
            manufacturer = EvidenceFieldResult("samsung", EvidenceStatus.AVAILABLE, "ADB"),
            brand = EvidenceFieldResult("samsung", EvidenceStatus.AVAILABLE, "ADB"),
            model = EvidenceFieldResult("SM-G991B", EvidenceStatus.AVAILABLE, "ADB"),
            device = dummyField,
            product = dummyField,
            buildId = dummyField,
            androidVersion = EvidenceFieldResult("14", EvidenceStatus.AVAILABLE, "ADB"),
            apiLevel = EvidenceFieldResult(34, EvidenceStatus.AVAILABLE, "ADB"),
            securityPatch = dummyField,
            platformIdentifier = dummyField,
            hardwareSerial = dummyId,
            imei = dummyId,
        )

        val report = CyvoriqCertifiedConditionReport(
            header = createSampleHeader().copy(reportTitle = "CYVORIQ Certified Device Condition & Diagnostic Report"),
            deviceIdentity = identity,
            diagnosticSummary = listOf("display functional", "cameras functional", "battery healthy"),
            gradingDecision = gradingDecision,
            integrity = ReportIntegrityRecord(
                algorithm = "SHA-256",
                contentDigest = "dummy-sha256-hash",
                signatureBlockPresent = true,
            ),
        )

        val json = Json { prettyPrint = true; encodeDefaults = true }
        val serialized = json.encodeToString(report)
        val decoded = json.decodeFromString<CyvoriqCertifiedConditionReport>(serialized)

        assertEquals("CYVORIQ Solutions", decoded.header.organization)
        assertEquals("samsung", decoded.deviceIdentity.manufacturer.value)
        assertEquals(OverallCertifiedGrade.GRADE_B, decoded.gradingDecision.overallGrade)
        assertEquals(2, decoded.gradingDecision.physicalFindingsSummary.size)
        assertEquals("dummy-sha256-hash", decoded.integrity?.contentDigest)
    }

    @Test
    fun serializesAndDeserializesSanitizationCertificateReport() {
        val dummyField = EvidenceFieldResult("test", EvidenceStatus.AVAILABLE, "ADB")
        val dummyId = DeviceIdentifierRecord("SERIAL", "SERIAL123", "ADB", "DEVICE", EvidenceStatus.AVAILABLE)
        val identity = DeviceIdentityEvidence(
            manufacturer = EvidenceFieldResult("samsung", EvidenceStatus.AVAILABLE, "ADB"),
            brand = EvidenceFieldResult("samsung", EvidenceStatus.AVAILABLE, "ADB"),
            model = EvidenceFieldResult("SM-G991B", EvidenceStatus.AVAILABLE, "ADB"),
            device = dummyField,
            product = dummyField,
            buildId = dummyField,
            androidVersion = EvidenceFieldResult("14", EvidenceStatus.AVAILABLE, "ADB"),
            apiLevel = EvidenceFieldResult(34, EvidenceStatus.AVAILABLE, "ADB"),
            securityPatch = dummyField,
            platformIdentifier = dummyField,
            hardwareSerial = dummyId,
            imei = dummyId,
        )

        val storage = StorageEvidence(
            internalTotalBytes = EvidenceFieldResult(128000000000L, EvidenceStatus.AVAILABLE, "ADB"),
            internalAvailableBytes = EvidenceFieldResult(120000000000L, EvidenceStatus.AVAILABLE, "ADB"),
            externalStoragePresent = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
            scopedStorageEnforced = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
        )

        val battery = BatteryEvidence(
            levelPercent = EvidenceFieldResult(85, EvidenceStatus.AVAILABLE, "ADB"),
            isCharging = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
            health = EvidenceFieldResult("GOOD", EvidenceStatus.AVAILABLE, "ADB"),
            stateOfHealthSoh = EvidenceFieldResult(null, EvidenceStatus.RESTRICTED, "ADB"),
        )

        val preRecord = PreSanitizationRecord(
            operationId = "PURGE-OP-01",
            sessionUuid = "SESS-1001",
            identity = identity,
            storageSnapshot = storage,
            batterySnapshot = battery,
            selectedMethod = SanitizationMethodType.CLEAR_PLATFORM_RESET,
            capabilityAssessment = DeviceCapabilityAssessment(
                manufacturer = "samsung",
                model = "SM-G991B",
                apiLevel = 34,
                isOemAdapterAvailable = false,
                resolvedOemAdapter = null,
                capabilities = emptyList(),
                recommendedPurgeAction = "PLATFORM FACTORY RESET",
            ),
            authorization = AuthorizationRequirement(
                operationId = "PURGE-OP-01",
                requiresOperatorConfirmation = true,
                confirmationPhrase = "CONFIRM PURGE",
                isAuthorized = true,
                authorizedBy = "operator@cyvoriq.com",
            ),
            operatorId = "operator@cyvoriq.com",
        )

        val executionResult = SanitizationExecutionResult(
            operationId = "PURGE-OP-01",
            method = SanitizationMethodType.CLEAR_PLATFORM_RESET,
            isSuccess = true,
            executionStatus = "SIMULATED_SUCCESS_G5_NON_DESTRUCTIVE",
        )

        val verificationResult = VerificationResult(
            operationId = "PURGE-OP-01",
            sessionUuid = "SESS-1001",
            status = SanitizationVerificationStatus.VERIFIED,
            postResetStateDetected = true,
            userDataInaccessible = true,
            setupWizardDetected = true,
            assuranceLevel = "NIST_SP_800_88_REV2_CLEAR_PLATFORM_VERIFIED",
        )

        val certReport = SanitizationCertificateReport(
            header = createSampleHeader().copy(
                reportId = "CYVRA-CERT-2026-90412",
                reportTitle = "CYVRA Data Sanitization & Verification Certificate",
            ),
            preSanitizationRecord = preRecord,
            executionResult = executionResult,
            verificationResult = verificationResult,
            nistStandardReference = "NIST SP 800-88 Rev. 2",
            assuranceDeclaration = "NIST_SP_800_88_REV2_CLEAR_PLATFORM_VERIFIED",
            postResetAdbState = "DEVICE_OOBE",
            setupWizardConfirmed = true,
            userAccountsRemoved = true,
            integrity = ReportIntegrityRecord(
                algorithm = "SHA-256",
                contentDigest = "hash-1234567890",
            ),
        )

        val json = Json { prettyPrint = true; encodeDefaults = true }
        val serialized = json.encodeToString(certReport)
        val decoded = json.decodeFromString<SanitizationCertificateReport>(serialized)

        assertEquals("CYVRA-CERT-2026-90412", decoded.header.reportId)
        assertEquals("NIST SP 800-88 Rev. 2", decoded.nistStandardReference)
        assertEquals("DEVICE_OOBE", decoded.postResetAdbState)
        assertTrue(decoded.setupWizardConfirmed)
        assertTrue(decoded.userAccountsRemoved)
        assertEquals(SanitizationVerificationStatus.VERIFIED, decoded.verificationResult.status)
    }
}
