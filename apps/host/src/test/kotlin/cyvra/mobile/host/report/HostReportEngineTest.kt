package cyvra.mobile.host.report

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
import cyvra.mobile.core.ReportCoverageLabel
import cyvra.mobile.core.RequiredAccessTier
import cyvra.mobile.core.SanitizationExecutionResult
import cyvra.mobile.core.SanitizationMethodType
import cyvra.mobile.core.SanitizationVerificationStatus
import cyvra.mobile.core.SecurityEvidence
import cyvra.mobile.core.StorageEvidence
import cyvra.mobile.core.VerificationResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class HostReportEngineTest {

    private val engine = HostReportEngine()

    private fun createSampleEvidence(): GenericDeviceEvidence {
        val dummyField = EvidenceFieldResult("test", EvidenceStatus.AVAILABLE, "ADB")
        val dummyIdRecord = DeviceIdentifierRecord("IMEI", null, "ADB", "DEVICE", EvidenceStatus.RESTRICTED, "Non-root ADB restriction")
        val identity = DeviceIdentityEvidence(
            manufacturer = EvidenceFieldResult("Google", EvidenceStatus.AVAILABLE, "ADB"),
            brand = EvidenceFieldResult("Google", EvidenceStatus.AVAILABLE, "ADB"),
            model = EvidenceFieldResult("Pixel 8", EvidenceStatus.AVAILABLE, "ADB"),
            device = dummyField,
            product = dummyField,
            buildId = dummyField,
            androidVersion = EvidenceFieldResult("14", EvidenceStatus.AVAILABLE, "ADB"),
            apiLevel = EvidenceFieldResult(34, EvidenceStatus.AVAILABLE, "ADB"),
            securityPatch = dummyField,
            platformIdentifier = dummyField,
            hardwareSerial = dummyIdRecord,
            imei = dummyIdRecord,
        )
        val battery = BatteryEvidence(
            levelPercent = EvidenceFieldResult(92, EvidenceStatus.AVAILABLE, "ADB"),
            isCharging = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
            health = EvidenceFieldResult("GOOD", EvidenceStatus.AVAILABLE, "ADB"),
            stateOfHealthSoh = EvidenceFieldResult(null, EvidenceStatus.RESTRICTED, "ADB"),
        )
        val storage = StorageEvidence(
            internalTotalBytes = EvidenceFieldResult(128000000000L, EvidenceStatus.AVAILABLE, "ADB"),
            internalAvailableBytes = EvidenceFieldResult(85000000000L, EvidenceStatus.AVAILABLE, "ADB"),
            externalStoragePresent = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
            scopedStorageEnforced = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
        )
        val security = SecurityEvidence(
            screenLockPresent = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
            secureBootEnabled = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
            deviceOwnerActive = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
            adbEnabled = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
            knoxClaim = EvidenceFieldResult(null, EvidenceStatus.RESTRICTED, "ADB"),
        )

        return GenericDeviceEvidence(
            sessionUuid = "SESS-REPORT-001",
            collectedAt = "2026-09-15T06:00:00Z",
            identity = identity,
            battery = battery,
            storage = storage,
            security = security,
        )
    }

    private fun createSampleAssessment(): DeviceCapabilityAssessment {
        return DeviceCapabilityAssessment(
            manufacturer = "Google",
            model = "Pixel 8",
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
    }

    @Test
    fun generatesVerificationReportWithSha256IntegrityDigest() {
        val evidence = createSampleEvidence()
        val assessment = createSampleAssessment()

        val report = engine.generateVerificationReport(
            reportId = "CYVRA-R1-2026-00001",
            operatorId = "OP-TESTER",
            evidence = evidence,
            assessment = assessment,
        )

        assertEquals("CYVRA-R1-2026-00001", report.header.reportId)
        assertEquals(ReportCoverageLabel.PARTIAL, report.coverage)
        assertNotNull(report.integrity)
        assertEquals("SHA-256", report.integrity?.algorithm)
        assertEquals(64, report.integrity?.contentDigest?.length) // 64 hex characters for SHA-256

        val json = engine.exportToJson(report)
        assertTrue(json.contains("CYVRA Device Verification Report"))
        assertTrue(json.contains("Pixel 8"))
        assertTrue(json.contains(report.integrity!!.contentDigest))

        val md = engine.renderMarkdown(report)
        assertTrue(md.contains("# CYVRA Device Verification Report"))
        assertTrue(md.contains("Google"))
        assertTrue(md.contains("CYVRA-R1-2026-00001"))
    }

    @Test
    fun generatesSanitizationCertificateWithTamperEvidentSha256Digest() {
        val evidence = createSampleEvidence()
        val assessment = createSampleAssessment()
        val auth = AuthorizationRequirement(
            operationId = "PURGE-OP-99",
            requiresOperatorConfirmation = true,
            confirmationPhrase = "AUTHORIZE PURGE-OP-99",
            isAuthorized = true,
            authorizedBy = "Tech-Lead",
        )
        val preRecord = PreSanitizationRecord(
            operationId = "PURGE-OP-99",
            sessionUuid = "SESS-REPORT-001",
            identity = evidence.identity,
            storageSnapshot = evidence.storage,
            batterySnapshot = evidence.battery,
            selectedMethod = SanitizationMethodType.CLEAR_PLATFORM_RESET,
            capabilityAssessment = assessment,
            authorization = auth,
            operatorId = "Tech-Lead",
        )
        val execution = SanitizationExecutionResult(
            operationId = "PURGE-OP-99",
            method = SanitizationMethodType.CLEAR_PLATFORM_RESET,
            isSuccess = true,
            executionStatus = "SIMULATED_SUCCESS_G5_NON_DESTRUCTIVE",
        )
        val verification = VerificationResult(
            operationId = "PURGE-OP-99",
            sessionUuid = "SESS-REPORT-001",
            status = SanitizationVerificationStatus.PLATFORM_REPORTED_COMPLETE,
            postResetStateDetected = true,
            userDataInaccessible = true,
            setupWizardDetected = true,
            limitations = listOf("Direct NAND cell inspection withheld"),
            assuranceLevel = "NIST_SP_800_88_REV2_CLEAR_PLATFORM_VERIFIED",
        )

        val cert = engine.generateSanitizationCertificate(
            certificateId = "CYVRA-CERT-2026-99999",
            operatorId = "Tech-Lead",
            preRecord = preRecord,
            executionResult = execution,
            verificationResult = verification,
        )

        assertEquals("CYVRA-CERT-2026-99999", cert.header.reportId)
        assertEquals("NIST SP 800-88 Rev. 2", cert.nistStandardReference)
        assertNotNull(cert.integrity)
        assertEquals(64, cert.integrity?.contentDigest?.length)

        val json = engine.exportToJson(cert)
        assertTrue(json.contains("CYVRA Data Sanitization & Verification Certificate"), "JSON contains title")
        assertTrue(json.contains("NIST SP 800-88 Rev. 2"), "JSON contains NIST reference")

        val md = engine.renderMarkdown(cert)
        assertTrue(md.contains("# CYVRA Data Sanitization & Verification Certificate"), "MD contains title")
        assertTrue(md.contains("PURGE-OP-99"), "MD contains OP ID")
        assertTrue(md.contains("PLATFORM_REPORTED_COMPLETE"), "MD contains status")
        assertTrue(md.contains("DEVICE_OOBE"), "MD contains OOBE transport state")
        assertTrue(md.contains("User Accounts Removed"), "MD contains account removal status")
    }

    @Test
    fun generatesCertifiedConditionReportWithSha256AndAuditTrail() {
        val evidence = createSampleEvidence()
        val gradingDecision = cyvra.mobile.core.DeviceGradingDecisionRecord(
            gradingId = "GRADE-DEC-2026-001",
            inspectionId = "INSP-001",
            sessionUuid = "SESS-REPORT-001",
            deviceIdentifier = "PIXEL8-TEST-001",
            safetyGrade = cyvra.mobile.core.SafetyGrade.S0_SAFE_TO_PROCESS,
            cosmeticGrade = cyvra.mobile.core.CosmeticGrade.B_LIGHT_WEAR,
            functionalGrade = cyvra.mobile.core.FunctionalGrade.F0_FULLY_VERIFIED,
            overallGrade = cyvra.mobile.core.OverallCertifiedGrade.GRADE_B,
            rulesVersion = "GRADE-IN-001",
            methodology = "CYVORIQ Mobile Physical Inspection Standard v1.0",
            presentation = cyvra.mobile.core.CountryGradingProfilePresentation(
                safetyLabel = "S0 — Safe to Process",
                cosmeticLabel = "Grade B — Light Wear",
                functionalLabel = "Fully Verified",
                overallLabel = "Grade B (Certified Good)",
            ),
            physicalFindingsSummary = listOf(
                "2 light frame scratches",
                "no visible screen crack",
                "no visible back-glass crack",
            ),
            diagnosticFindingsSummary = listOf(
                "display functional",
                "cameras functional",
                "battery healthy",
            ),
        )

        val humanReview = cyvra.mobile.core.HumanReviewSessionRecord(
            reviewSessionId = "REV-SESS-900",
            sessionUuid = "SESS-REPORT-001",
            deviceIdentifier = "PIXEL8-TEST-001",
            allExceptionsResolved = true,
            reviewerSignature = "TECH-SIGN-992",
            decisions = listOf(
                cyvra.mobile.core.DefectReviewDecision(
                    reviewItemId = "REV-ITEM-1",
                    defectId = "DEFECT-FRAME-01",
                    defectDescription = "Light frame micro-scratch",
                    initialAiConfidence = 0.88,
                    triggerReason = cyvra.mobile.core.ReviewTriggerReason.LOW_CONFIDENCE_THRESHOLD,
                    action = cyvra.mobile.core.HumanReviewAction.ACCEPT,
                    operatorId = "operator@cyvoriq.com",
                )
            ),
        )

        val report = engine.generateCertifiedConditionReport(
            reportId = "CYVRA-COND-2026-00042",
            operatorId = "operator@cyvoriq.com",
            sessionUuid = "SESS-REPORT-001",
            customerOrganization = "CYVORIQ Global Testing",
            licenseKey = "CYVRA-LIC-2026-PREVIEW",
            deviceIdentity = evidence.identity,
            diagnosticSummary = listOf("Display touch multi-point verified", "Battery health Good"),
            gradingDecision = gradingDecision,
            humanReviewSession = humanReview,
        )

        assertEquals("CYVRA-COND-2026-00042", report.header.reportId)
        assertEquals("CV-MOBILE-001", report.aiModelVersion)
        assertEquals("GRADE-IN-001", report.rulesVersion)
        assertEquals(6, report.physicalInspectionViewsAccepted)
        assertNotNull(report.integrity)
        assertEquals(64, report.integrity?.contentDigest?.length)
        assertTrue(report.integrity?.signatureBlockPresent == true)

        val json = engine.exportToJson(report)
        assertTrue(json.contains("CYVORIQ Certified Device Condition & Diagnostic Report"))
        assertTrue(json.contains("CYVRA-COND-2026-00042"))

        val md = engine.renderMarkdown(report)
        assertTrue(md.contains("# CYVORIQ CERTIFIED DEVICE CONDITION & DIAGNOSTIC REPORT"))
        assertTrue(md.contains("Grade B (Certified Good)"))
        assertTrue(md.contains("2 light frame scratches"))
        assertTrue(md.contains("TECH-SIGN-992"))
    }
}
