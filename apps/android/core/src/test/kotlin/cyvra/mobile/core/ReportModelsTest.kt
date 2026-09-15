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
}
