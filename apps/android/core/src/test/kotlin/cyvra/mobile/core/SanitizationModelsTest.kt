package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class SanitizationModelsTest {

    @Test
    fun verifiesSanitizationModelsAndNonBinaryStatus() {
        val auth = AuthorizationRequirement(
            operationId = "OP-100",
            requiresOperatorConfirmation = true,
            confirmationPhrase = "AUTHORIZE OP-100",
            isAuthorized = true,
            authorizedBy = "Tech-01",
            authorizedAt = "2026-09-15T06:00:00Z",
        )

        val verification = VerificationResult(
            operationId = "OP-100",
            sessionUuid = "SESS-100",
            status = SanitizationVerificationStatus.PLATFORM_REPORTED_COMPLETE,
            postResetStateDetected = true,
            userDataInaccessible = true,
            setupWizardDetected = true,
            limitations = listOf("Direct flash cell validation withheld (§33)"),
            assuranceLevel = "NIST_SP_800_88_REV2_CLEAR",
        )

        val json = Json { prettyPrint = true }
        val serialized = json.encodeToString(verification)

        assertTrue(serialized.contains("PLATFORM_REPORTED_COMPLETE"))
        assertFalse(serialized.contains("\"PASS\"")) // Binary PASS is forbidden (§36)

        val decoded = json.decodeFromString<VerificationResult>(serialized)
        assertEquals(SanitizationVerificationStatus.PLATFORM_REPORTED_COMPLETE, decoded.status)
        assertEquals("OP-100", decoded.operationId)
        assertTrue(decoded.setupWizardDetected)
    }
}
