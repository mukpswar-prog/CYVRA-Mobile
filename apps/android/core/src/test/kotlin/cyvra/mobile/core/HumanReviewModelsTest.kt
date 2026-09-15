package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HumanReviewModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesHumanReviewSession() {
        val decision = DefectReviewDecision(
            reviewItemId = "REV-ITEM-001",
            defectId = "DEF-BODY-001",
            defectDescription = "Back glass crack hairline",
            initialAiConfidence = 0.82,
            triggerReason = ReviewTriggerReason.LOW_CONFIDENCE_THRESHOLD,
            action = HumanReviewAction.ACCEPT,
            operatorId = "operator@cyvoriq.com",
            operatorNotes = "Confirmed hairline fracture under direct light",
            imageHash = "dummy-sha256",
        )

        val session = HumanReviewSessionRecord(
            reviewSessionId = "REV-SESS-001",
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            decisions = listOf(decision),
            allExceptionsResolved = true,
            requiresRecapture = false,
            reviewerSignature = "OP-SIGN-001",
            completedAt = java.time.Instant.now().toString(),
        )

        val encoded = json.encodeToString(session)
        val decoded = json.decodeFromString<HumanReviewSessionRecord>(encoded)

        assertEquals("REV-SESS-001", decoded.reviewSessionId)
        assertEquals(1, decoded.decisions.size)
        assertEquals(HumanReviewAction.ACCEPT, decoded.decisions[0].action)
        assertEquals(0.82, decoded.decisions[0].initialAiConfidence)
        assertTrue(decoded.allExceptionsResolved)
    }
}
