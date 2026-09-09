package cyvra.mobile.core

fun planEvidence(
    profile: CapabilityProfile,
    catalog: List<TestDefinition> = S1Catalog.tests,
    contract: CapabilityContract = S1Catalog.contract,
): List<PlannedTest> = catalog.map { test -> planOne(profile, test, contract) }

private fun planOne(
    profile: CapabilityProfile,
    test: TestDefinition,
    contract: CapabilityContract,
): PlannedTest {
    val rule = contract.rules.find { it.tests.contains(test.testId) }

    if (test.s1ForbiddenPass || rule?.s1ForbiddenPass == true) {
        return finish(
            test,
            readiness = "FORBIDDEN_ON_LAYER",
            uiStatus = "Not available on S1",
            plannedResult = "NOT_AVAILABLE",
            limitation = "LAYER_FORBIDDEN",
        )
    }

    if (test.observationOnly) {
        return finish(
            test,
            readiness = "NOT_TESTED",
            uiStatus = "Observation",
            plannedResult = "NOT_TESTED",
        )
    }

    val missingFeature = test.requireFeatures.find { feature ->
        profile.features.none { it.feature == feature && it.declared }
    }
    if (missingFeature != null) {
        val result = rule?.missingFeatureResult ?: "NOT_SUPPORTED"
        return finish(
            test,
            readiness = "NOT_SUPPORTED",
            uiStatus = "Not supported",
            plannedResult = result,
            limitation = if (result == "NOT_SUPPORTED") "HARDWARE_ABSENT" else "FEATURE_UNDECLARED",
        )
    }

    val missingPermission = test.requirePermissions.find { permission ->
        if (permission == VIBRATE_PERMISSION) false
        else profile.permissions.none { it.permission == permission && it.granted }
    }
    if (missingPermission != null) {
        return finish(
            test,
            readiness = "PERMISSION_DENIED",
            uiStatus = "Permission required",
            plannedResult = "PERMISSION_DENIED",
            limitation = "PERMISSION_DENIED",
        )
    }

    return finish(
        test,
        readiness = "READY",
        uiStatus = "Ready to test",
        plannedResult = "NOT_TESTED",
    )
}

private fun finish(
    test: TestDefinition,
    readiness: String,
    uiStatus: String,
    plannedResult: String,
    limitation: String? = null,
): PlannedTest = PlannedTest(
    testId = test.testId,
    userName = test.userName,
    objectiveName = test.objectiveName,
    domain = test.domain,
    readiness = readiness,
    uiStatus = uiStatus,
    plannedResult = plannedResult,
    limitation = limitation,
)
