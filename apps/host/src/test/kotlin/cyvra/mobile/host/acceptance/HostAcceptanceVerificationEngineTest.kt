package cyvra.mobile.host.acceptance

import cyvra.mobile.core.AcceptanceJourneyStage
import cyvra.mobile.core.AcceptanceStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HostAcceptanceVerificationEngineTest {

    private val engine = HostAcceptanceVerificationEngine()

    /**
     * With no observations supplied the engine measures nothing about the product, so it
     * must report nothing as passed. This test previously asserted the opposite: the
     * engine stamped every check PASSED, marked all 18 journey stages completed, and
     * sealed the lot - an acceptance report describing a product it had not examined.
     */
    @Test
    fun doesNotClaimAcceptanceWhenNoObservationsAreSupplied() {
        val report = engine.evaluateSystemAcceptance(targetVersion = "3.2.2-g5")

        assertEquals("3.2.2-g5", report.targetVersion)
        assertFalse(report.isSystemAcceptancePassed)
        assertEquals(0, report.failedCheckCount)
        assertTrue(report.totalCheckCount >= 18)
        // Nothing was evaluated, so nothing passed and the evaluation is incomplete.
        assertEquals(report.totalCheckCount, report.notEvaluatedCount)
        assertEquals(0, report.passedCheckCount)
        assertEquals(0, report.completedStages.size)
        assertTrue(report.sha256VerificationSeal.isNotBlank())
        assertTrue(
            report.checks.all { it.status == AcceptanceStatus.NOT_EVALUATED },
            "no check may report PASSED without an observation behind it",
        )

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

    /**
     * The capability survives: given a complete set of real observations the engine still
     * reaches acceptance. Making it honest must not have made it unable to pass - only
     * unable to pass for free.
     */
    @Test
    fun reachesAcceptanceWhenEveryCheckIsObservedPassing() {
        val ids = engine.evaluateSystemAcceptance().checks.map { it.checkId }
        val observations = ids.associateWith { AcceptanceStatus.PASSED }

        val report = engine.evaluateSystemAcceptance(
            targetVersion = "3.2.2-g5",
            observations = observations,
            completedStages = AcceptanceJourneyStage.entries.toList(),
        )

        assertTrue(report.isSystemAcceptancePassed)
        assertEquals(0, report.failedCheckCount)
        assertEquals(0, report.notEvaluatedCount)
        assertEquals(report.totalCheckCount, report.passedCheckCount)
        assertEquals(AcceptanceJourneyStage.entries.size, report.completedStages.size)
    }

    /**
     * A single unobserved check must be enough to withhold acceptance, even when every
     * other check passes.
     */
    @Test
    fun withholdsAcceptanceWhileAnyCheckRemainsUnevaluated() {
        val checks = engine.evaluateSystemAcceptance().checks
        val observations = checks
            .filter { it.checkId != "PURGE-003" }
            .associate { it.checkId to AcceptanceStatus.PASSED }

        val report = engine.evaluateSystemAcceptance(observations = observations)

        assertFalse(report.isSystemAcceptancePassed)
        assertEquals(1, report.notEvaluatedCount)
        assertEquals(0, report.failedCheckCount)
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
