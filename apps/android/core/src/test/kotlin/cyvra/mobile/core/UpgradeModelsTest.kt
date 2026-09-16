package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class UpgradeModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesEntitlementRevisionRecord() {
        val record = EntitlementRevisionRecord(
            revisionNumber = 2,
            serialNumber = "CYVRA15092026SA3F1-2-25",
            plan = ScanEntitlementPlan.TIER_25,
            totalScans = 25,
            carriedOverUsage = 2,
            scansRemaining = 23,
            status = LicenseEntitlementStatus.ACTIVE,
            activatedAt = "2026-09-15T16:00:00Z",
            supersededAt = null,
            externalOrderId = "ORD-CYVRA-90412",
        )

        val encoded = json.encodeToString(record)
        val decoded = json.decodeFromString<EntitlementRevisionRecord>(encoded)

        assertEquals(2, decoded.revisionNumber)
        assertEquals("CYVRA15092026SA3F1-2-25", decoded.serialNumber)
        assertEquals(ScanEntitlementPlan.TIER_25, decoded.plan)
        assertEquals(25, decoded.totalScans)
        assertEquals(2, decoded.carriedOverUsage)
        assertEquals(23, decoded.scansRemaining)
        assertEquals(LicenseEntitlementStatus.ACTIVE, decoded.status)
        assertEquals("ORD-CYVRA-90412", decoded.externalOrderId)
    }

    @Test
    fun serializesAndDeserializesUpgradeHandoffRequest() {
        val request = UpgradeHandoffRequest(
            requestId = "UPG-REQ-001",
            licenseId = "LIC-MOB-2026-00124",
            currentSerial = "CYVRA15092026SA3F1-1-3",
            currentRevision = 1,
            targetPlan = ScanEntitlementPlan.TIER_25,
            customerEmail = "tech@partner.com",
            handoffUrl = "https://www.cyvoriq.co.in/checkout/upgrade?reqId=UPG-REQ-001",
        )

        val encoded = json.encodeToString(request)
        val decoded = json.decodeFromString<UpgradeHandoffRequest>(encoded)

        assertEquals("UPG-REQ-001", decoded.requestId)
        assertEquals("LIC-MOB-2026-00124", decoded.licenseId)
        assertEquals(ScanEntitlementPlan.TIER_25, decoded.targetPlan)
        assertTrue(decoded.handoffUrl.contains("UPG-REQ-001"))
    }

    @Test
    fun serializesAndDeserializesScanLedgerEntry() {
        val entry = ScanLedgerEntry(
            transactionId = "TX-SCAN-001",
            licenseId = "LIC-MOB-2026-00124",
            revisionNumber = 1,
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            eventType = ScanCommitStatus.VERIFIED_AND_DEBITED,
            scanSequenceNumber = 3,
            reportId = "CYVRA-R1-2026-001",
            operatorId = "operator@cyvoriq.com",
        )

        val encoded = json.encodeToString(entry)
        val decoded = json.decodeFromString<ScanLedgerEntry>(encoded)

        assertEquals("TX-SCAN-001", decoded.transactionId)
        assertEquals(ScanCommitStatus.VERIFIED_AND_DEBITED, decoded.eventType)
        assertEquals(3, decoded.scanSequenceNumber)
        assertEquals("CYVRA-R1-2026-001", decoded.reportId)
    }
}
