package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AcceptanceModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesSystemAcceptanceReport() {
        val check = AcceptanceCheckItem(
            category = "Product UI",
            checkId = "UI-001",
            title = "CYVRA Desktop Branding & Shell",
            description = "Standard header, navigation, status bar, and dialog frames verified.",
            status = AcceptanceStatus.PASSED,
            evidenceDigest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        )

        val report = SystemAcceptanceReport(
            acceptanceId = "ACC-E2E-TEST01",
            targetVersion = "3.2.2-g5",
            completedStages = listOf(AcceptanceJourneyStage.INSTALL_AND_ACTIVATE, AcceptanceJourneyStage.CONNECT_DEVICE),
            totalCheckCount = 1,
            passedCheckCount = 1,
            failedCheckCount = 0,
            isSystemAcceptancePassed = true,
            checks = listOf(check),
            sha256VerificationSeal = "f0e4c2f76c58916ec258f246851bea091d14d4247a2fc3e18694461b1816e13b",
        )

        val encoded = json.encodeToString(report)
        val decoded = json.decodeFromString<SystemAcceptanceReport>(encoded)

        assertEquals("ACC-E2E-TEST01", decoded.acceptanceId)
        assertEquals("3.2.2-g5", decoded.targetVersion)
        assertTrue(decoded.isSystemAcceptancePassed)
        assertEquals(1, decoded.checks.size)
        assertEquals("UI-001", decoded.checks[0].checkId)
        assertEquals(AcceptanceStatus.PASSED, decoded.checks[0].status)
    }
}
