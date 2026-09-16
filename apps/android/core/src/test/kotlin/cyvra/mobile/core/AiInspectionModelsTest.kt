package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class AiInspectionModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesInspectionSessionRecord() {
        val qualityGate = ImageQualityGateResult(
            status = ImageQualityStatus.PASSED,
            isAcceptableForInference = true,
            score = 0.98,
            operatorFeedback = "Quality verified.",
        )

        val capture = PhysicalViewCaptureRecord(
            viewId = "VIEW-FRONT-001",
            inspectionId = "INSP-001",
            sessionUuid = "SESS-UUID-1",
            deviceIdentifier = "RF8R123456",
            view = PhysicalInspectionView.FRONT,
            imageSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            qualityGate = qualityGate,
        )

        val session = PhysicalInspectionSessionRecord(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-UUID-1",
            deviceIdentifier = "RF8R123456",
            captures = listOf(capture),
            isCompleteSequence = false,
        )

        val encoded = json.encodeToString(session)
        val decoded = json.decodeFromString<PhysicalInspectionSessionRecord>(encoded)

        assertEquals("INSP-001", decoded.inspectionId)
        assertEquals(1, decoded.captures.size)
        assertEquals(PhysicalInspectionView.FRONT, decoded.captures[0].view)
        assertEquals(ImageQualityStatus.PASSED, decoded.captures[0].qualityGate.status)
        assertTrue(decoded.captures[0].imageSha256.isNotEmpty())
    }
}
