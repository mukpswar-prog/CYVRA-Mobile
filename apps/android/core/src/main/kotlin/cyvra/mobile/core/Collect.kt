package cyvra.mobile.core

import java.util.UUID

fun newEvidenceId(): String = UUID.randomUUID().toString()

/**
 * Turn a capability plan into honest S1 records.
 * Ready tests stay NOT_TESTED until a later slice actually runs them.
 * IMEI / battery SOH / Knox stay NOT_AVAILABLE. Never PASS.
 */
fun recordFromPlan(
    planned: PlannedTest,
    evidenceId: String,
    deviceLifecycleId: String,
    processingSessionId: String,
    collectedAt: String,
): EvidenceRecord {
    require(planned.plannedResult != "PASS") {
        "S1 plan must not emit PASS (${planned.testId})"
    }
    return when (planned.testId) {
        "IDN.IMEI_SERIAL" ->
            S1Collectors.imeiSerial(
                evidenceId,
                deviceLifecycleId,
                processingSessionId,
                collectedAt,
            )
        "PWR.BATTERY_SOH" ->
            S1Collectors.batterySoh(
                evidenceId,
                deviceLifecycleId,
                processingSessionId,
                collectedAt,
            )
        "SEC.KNOX_CLAIM" ->
            S1Collectors.knoxClaim(
                evidenceId,
                deviceLifecycleId,
                processingSessionId,
                collectedAt,
            )
        else ->
            EvidenceRecord(
                evidenceId = evidenceId,
                deviceLifecycleId = deviceLifecycleId,
                processingSessionId = processingSessionId,
                testId = planned.testId,
                result = planned.plannedResult,
                collectedAt = collectedAt,
                method = "s1-capability-plan",
                limitation = planned.limitation,
                notes = planned.uiStatus,
            )
    }
}

fun queuePlannedBatch(
    profile: CapabilityProfile,
    deviceLifecycleId: String,
    processingSessionId: String,
    batchId: String,
    collectedAt: String,
    idFactory: () -> String = { newEvidenceId() },
): EvidenceBatch {
    val queue = OfflineQueue()
    for (planned in planEvidence(profile)) {
        val record = recordFromPlan(
            planned,
            evidenceId = idFactory(),
            deviceLifecycleId = deviceLifecycleId,
            processingSessionId = processingSessionId,
            collectedAt = collectedAt,
        )
        queue.enqueue(record, queuedAt = collectedAt)
    }
    return queue.toBatch(batchId = batchId, createdAt = collectedAt)
}
