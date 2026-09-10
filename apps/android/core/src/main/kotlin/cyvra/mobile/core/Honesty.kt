package cyvra.mobile.core

data class HonestyIssue(val testId: String, val reason: String)

fun assertS1Honesty(record: EvidenceRecord): List<HonestyIssue> {
    val issues = mutableListOf<HonestyIssue>()
    val definition = S1Catalog.definition(record.testId)

    if (
        record.source == "S1_APPLICATION" &&
        record.result == "FAIL" &&
        record.limitation in setOf(
            "PERMISSION_DENIED",
            "HARDWARE_ABSENT",
            "LAYER_FORBIDDEN",
            "API_PRIVILEGED",
        )
    ) {
        issues += HonestyIssue(record.testId, "Limitation codes must not be stored as FAIL")
    }

    if (
        record.source == "S1_APPLICATION" &&
        record.result == "PASS" &&
        (definition?.s1ForbiddenPass == true || record.testId in S1_FORBIDDEN_PASS_IDS)
    ) {
        issues += HonestyIssue(
            record.testId,
            "S1 must not emit PASS for IMEI, battery SOH, or Knox attestation",
        )
    }

    if (
        record.source == "S1_APPLICATION" &&
        record.testId == "SEC.LOCK_PRESENT" &&
        record.payload["bypassAttempted"] == "true"
    ) {
        issues += HonestyIssue(record.testId, "S1 must not attempt lock/FRP bypass")
    }

    return issues
}

fun recordIsHonest(record: EvidenceRecord): Boolean = assertS1Honesty(record).isEmpty()
