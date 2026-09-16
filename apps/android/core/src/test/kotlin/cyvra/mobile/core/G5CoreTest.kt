package cyvra.mobile.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class G5CoreTest {
    private fun feature(name: String, declared: Boolean) =
        FeatureFact(feature = name, declared = declared, state = "DECLARED")

    private fun samsungPhone(cameraGranted: Boolean = false): CapabilityProfile = CapabilityProfile(
        manufacturer = "samsung",
        brand = "samsung",
        model = "generic",
        sdkInt = 34,
        smallestScreenWidthDp = 360,
        features = listOf(
            feature("android.hardware.camera", true),
            feature("android.hardware.camera.front", true),
            feature("android.hardware.camera.any", true),
            feature("android.hardware.touchscreen", true),
            feature("android.hardware.microphone", true),
            feature("android.hardware.wifi", true),
            feature("android.hardware.bluetooth", true),
            feature("android.hardware.telephony", true),
            feature("android.hardware.audio.output", true),
            feature("android.hardware.sensor.accelerometer", true),
            feature("android.hardware.sensor.gyroscope", true),
            feature("android.hardware.sensor.proximity", true),
            feature("android.hardware.sensor.light", true),
            feature("android.hardware.sensor.compass", true),
        ),
        permissions = listOf(PermissionFact("android.permission.CAMERA", cameraGranted)),
    )

    @Test
    fun catalogLoadsFortyOneTests() {
        assertEquals("CYVRA-CC-S1-V1", S1Catalog.contract.contractId)
        assertEquals(41, S1Catalog.tests.size)
        assertEquals(S1Catalog.tests.map { it.testId }.toSet().size, S1Catalog.tests.size)
    }

    @Test
    fun permissionDeniedIsNotFailure() {
        assertTrue(isNonFailure("PERMISSION_DENIED"))
        assertFalse(isFailure("PERMISSION_DENIED"))
        assertFailsWith<IllegalStateException> { coerceToFail("PERMISSION_DENIED") }
    }

    @Test
    fun missingCameraIsNotSupported() {
        val profile = samsungPhone().copy(
            features = samsungPhone().features.map {
                if (it.feature.contains("camera")) it.copy(declared = false) else it
            },
        )
        val camera = planEvidence(profile).first { it.testId == "FN.CAMERA_BACK_CAPTURE" }
        assertEquals("NOT_SUPPORTED", camera.plannedResult)
        assertEquals("Not supported", camera.uiStatus)
        assertFalse(isFailure(camera.plannedResult))
    }

    @Test
    fun deniedCameraPermissionIsPermissionDenied() {
        val camera = planEvidence(samsungPhone(cameraGranted = false))
            .first { it.testId == "FN.CAMERA_BACK_CAPTURE" }
        assertEquals("PERMISSION_DENIED", camera.plannedResult)
        assertEquals("Permission required", camera.uiStatus)
    }

    @Test
    fun readyToTestIsNeverPass() {
        val camera = planEvidence(samsungPhone(cameraGranted = true))
            .first { it.testId == "FN.CAMERA_BACK_CAPTURE" }
        assertEquals("READY", camera.readiness)
        assertEquals("Ready to test", camera.uiStatus)
        assertEquals("NOT_TESTED", camera.plannedResult)
    }

    @Test
    fun tabletWithoutTelephonyIsNotADefect() {
        val tablet = samsungPhone().copy(
            smallestScreenWidthDp = 800,
            features = samsungPhone().features.map {
                if (it.feature == "android.hardware.telephony") it.copy(declared = false) else it
            },
        )
        val cellular = planEvidence(tablet).first { it.testId == "NET.CELLULAR" }
        assertEquals("NOT_SUPPORTED", cellular.plannedResult)
    }

    @Test
    fun s1CannotPassImeiSohOrKnox() {
        for (testId in listOf("IDN.IMEI_SERIAL", "PWR.BATTERY_SOH", "SEC.KNOX_CLAIM")) {
            val planned = planEvidence(samsungPhone()).first { it.testId == testId }
            assertEquals("NOT_AVAILABLE", planned.plannedResult)
            val dishonest = EvidenceRecord(
                evidenceId = "44444444-4444-4444-8444-444444444444",
                deviceLifecycleId = "11111111-1111-4111-8111-111111111111",
                processingSessionId = "22222222-2222-4222-8222-222222222222",
                testId = testId,
                result = "PASS",
                collectedAt = "2026-09-09T12:00:00.000Z",
                method = "unit",
            )
            assertTrue(assertS1Honesty(dishonest).isNotEmpty())
        }
    }

    @Test
    fun collectorsDoNotPretendToReadImei() {
        val record = S1Collectors.imeiSerial(
            evidenceId = "44444444-4444-4444-8444-444444444444",
            deviceLifecycleId = "11111111-1111-4111-8111-111111111111",
            processingSessionId = "22222222-2222-4222-8222-222222222222",
            collectedAt = "2026-09-09T12:00:00.000Z",
        )
        assertEquals("NOT_AVAILABLE", record.result)
        assertTrue(recordIsHonest(record))
        assertFalse(record.notes.orEmpty().contains("IMEI=", ignoreCase = false) && record.result == "PASS")
    }

    @Test
    fun offlineQueuePreservesCollectedAtOnSync() {
        val queue = OfflineQueue()
        val record = S1Collectors.imeiSerial(
            evidenceId = "44444444-4444-4444-8444-444444444444",
            deviceLifecycleId = "11111111-1111-4111-8111-111111111111",
            processingSessionId = "22222222-2222-4222-8222-222222222222",
            collectedAt = "2026-09-09T12:00:00.000Z",
        )
        queue.enqueue(record, queuedAt = "2026-09-09T12:01:00.000Z")
        val afterSync = queue.markSynced(record.evidenceId, syncedAt = "2026-09-09T18:00:00.000Z")
        assertEquals("2026-09-09T12:00:00.000Z", afterSync.collectedAt)
        assertEquals(0, queue.pending().size)
    }

    @Test
    fun digestIgnoresKeyOrderAndDigestField() {
        val record = S1Collectors.batterySoh(
            evidenceId = "55555555-5555-4555-8555-555555555555",
            deviceLifecycleId = "11111111-1111-4111-8111-111111111111",
            processingSessionId = "22222222-2222-4222-8222-222222222222",
            collectedAt = "2026-09-09T12:00:00.000Z",
        )
        val a = digestCanonical(record)
        val b = digestCanonical(record.copy(digest = "deadbeef"))
        assertEquals(a, b)
        assertEquals(64, a.length)
    }

    @Test
    fun queueRejectsDishonestPass() {
        val queue = OfflineQueue()
        val bad = EvidenceRecord(
            evidenceId = "44444444-4444-4444-8444-444444444444",
            deviceLifecycleId = "11111111-1111-4111-8111-111111111111",
            processingSessionId = "22222222-2222-4222-8222-222222222222",
            testId = "IDN.IMEI_SERIAL",
            result = "PASS",
            collectedAt = "2026-09-09T12:00:00.000Z",
            method = "unit",
        )
        assertFailsWith<IllegalArgumentException> {
            queue.enqueue(bad, queuedAt = "2026-09-09T12:01:00.000Z")
        }
    }

    @Test
    fun plannedBatchIsHonestAndNeverPass() {
        var n = 0
        val batch = queuePlannedBatch(
            profile = samsungPhone(cameraGranted = false),
            deviceLifecycleId = "11111111-1111-4111-8111-111111111111",
            processingSessionId = "22222222-2222-4222-8222-222222222222",
            batchId = "33333333-3333-4333-8333-333333333333",
            collectedAt = "2026-09-11T11:00:00.000Z",
            idFactory = {
                n += 1
                "44444444-4444-4444-8444-${n.toString().padStart(12, '0')}"
            },
        )
        assertEquals(41, batch.records.size)
        assertTrue(batch.records.none { it.result == "PASS" })
        assertTrue(batch.records.all { recordIsHonest(it) })
        assertEquals(
            "NOT_AVAILABLE",
            batch.records.first { it.testId == "IDN.IMEI_SERIAL" }.result,
        )
        assertEquals(
            "PERMISSION_DENIED",
            batch.records.first { it.testId == "FN.CAMERA_BACK_CAPTURE" }.result,
        )
        val readyOrUntested = batch.records.first { it.testId == "IDN.BUILD_IDENTITY" }
        assertTrue(readyOrUntested.result in NON_FAILURE)
        assertTrue("PASS" !in readyOrUntested.result)
    }

    @Test
    fun plannedIngestJsonIsG4ShapedAndNeverPass() {
        var n = 0
        val json = plannedIngestJson(
            profile = samsungPhone(cameraGranted = false),
            deviceLifecycleId = "11111111-1111-4111-8111-111111111111",
            processingSessionId = "22222222-2222-4222-8222-222222222222",
            batchId = "33333333-3333-4333-8333-333333333333",
            profileId = "55555555-5555-4555-8555-555555555555",
            collectedAt = "2026-09-12T05:00:00.000Z",
            idFactory = {
                n += 1
                "44444444-4444-4444-8444-${n.toString().padStart(12, '0')}"
            },
        )
        assertTrue(json.contains("\"schemaVersion\":\"1.0.0\""))
        assertTrue(json.contains("\"batchId\":\"33333333-3333-4333-8333-333333333333\""))
        assertTrue(json.contains("\"profileId\":\"55555555-5555-4555-8555-555555555555\""))
        assertTrue(json.contains("\"testId\":\"IDN.IMEI_SERIAL\""))
        assertTrue(json.contains("\"result\":\"NOT_AVAILABLE\""))
        assertFalse(json.contains("\"result\":\"PASS\""))
        assertTrue(json.contains("\"source\":\"S1_APPLICATION\""))
        assertTrue(json.contains("\"manufacturer\":\"samsung\""))
    }
}
