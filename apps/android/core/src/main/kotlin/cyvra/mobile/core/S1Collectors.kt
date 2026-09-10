package cyvra.mobile.core

/** S1 collectors that must not call privileged/Knox APIs. */
object S1Collectors {
    fun unavailableOnS1(
        testId: String,
        evidenceId: String,
        deviceLifecycleId: String,
        processingSessionId: String,
        collectedAt: String,
        notes: String,
    ): EvidenceRecord = EvidenceRecord(
        evidenceId = evidenceId,
        deviceLifecycleId = deviceLifecycleId,
        processingSessionId = processingSessionId,
        testId = testId,
        source = "S1_APPLICATION",
        result = "NOT_AVAILABLE",
        collectedAt = collectedAt,
        method = "s1-layer-policy",
        limitation = "LAYER_FORBIDDEN",
        notes = notes,
    )

    fun imeiSerial(
        evidenceId: String,
        deviceLifecycleId: String,
        processingSessionId: String,
        collectedAt: String,
    ) = unavailableOnS1(
        testId = "IDN.IMEI_SERIAL",
        evidenceId = evidenceId,
        deviceLifecycleId = deviceLifecycleId,
        processingSessionId = processingSessionId,
        collectedAt = collectedAt,
        notes = "Android 10+ IMEI/serial require READ_PRIVILEGED_PHONE_STATE or Knox. S1 does not call getImei/getSerial.",
    )

    fun batterySoh(
        evidenceId: String,
        deviceLifecycleId: String,
        processingSessionId: String,
        collectedAt: String,
    ) = unavailableOnS1(
        testId = "PWR.BATTERY_SOH",
        evidenceId = evidenceId,
        deviceLifecycleId = deviceLifecycleId,
        processingSessionId = processingSessionId,
        collectedAt = collectedAt,
        notes = "Battery SOH is Knox Asset Intelligence / flagged API. S1 records BatteryManager status only.",
    )

    fun knoxClaim(
        evidenceId: String,
        deviceLifecycleId: String,
        processingSessionId: String,
        collectedAt: String,
    ) = unavailableOnS1(
        testId = "SEC.KNOX_CLAIM",
        evidenceId = evidenceId,
        deviceLifecycleId = deviceLifecycleId,
        processingSessionId = processingSessionId,
        collectedAt = collectedAt,
        notes = "Knox SDK is S3. S1 does not claim Samsung-authorized or Knox attestation.",
    )
}
