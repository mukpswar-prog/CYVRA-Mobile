package cyvra.mobile.host.acceptance

import cyvra.mobile.core.AcceptanceJourneyStage
import cyvra.mobile.core.AcceptanceStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HostAcceptanceVerificationEngineTest {

    private val engine = HostAcceptanceVerificationEngine()

    @Test
    fun evaluatesFullSystemAcceptanceSuccessfullyAcrossAllCategories() {
        val report = engine.evaluateSystemAcceptance(targetVersion = "3.2.2-g5")

        assertEquals("3.2.2-g5", report.targetVersion)
        assertTrue(report.isSystemAcceptancePassed)
        assertEquals(0, report.failedCheckCount)
        assertTrue(report.totalCheckCount >= 18)
        assertEquals(report.totalCheckCount, report.passedCheckCount)
        assertEquals(AcceptanceJourneyStage.entries.size, report.completedStages.size)
        assertTrue(report.sha256VerificationSeal.isNotBlank())

        val categories = report.checks.map { it.category }.distinct()
        assertTrue(categories.contains("Product UI"))
        assertTrue(categories.contains("Licensing"))
        assertTrue(categories.contains("Device"))
        assertTrue(categories.contains("Diagnostic"))
        assertTrue(categories.contains("Purge"))
        assertTrue(categories.contains("Update"))
        assertTrue(categories.contains("Upgrade"))
        assertTrue(categories.contains("Security"))
    }

    @Test
    fun detectsFailureWhenAnyMilestoneFails() {
        val report = engine.evaluateSystemAcceptance(
            targetVersion = "3.2.2-g5",
            simulateFailureCheckId = "PURGE-002",
        )

        assertFalse(report.isSystemAcceptancePassed)
        assertEquals(1, report.failedCheckCount)
        val failedCheck = report.checks.first { it.checkId == "PURGE-002" }
        assertEquals(AcceptanceStatus.FAILED, failedCheck.status)
    }

    @Test
    fun computesDeterministicSha256Digests() {
        val hash1 = engine.computeSha256("cyvra-acceptance-verification-seed")
        val hash2 = engine.computeSha256("cyvra-acceptance-verification-seed")

        assertEquals(hash1, hash2)
        assertEquals(64, hash1.length)
    }
}
