import { S1_TEST_CATALOG } from "./catalog";
import { S1_CAPABILITY_CONTRACT } from "./contract";
import type {
  CapabilityContract,
  CapabilityProfile,
  PlannedTest,
  TestDefinition,
  TestReadiness,
} from "./types";
import type { EvidenceResult, LimitationCode } from "./vocabulary";

function featureDeclared(
  profile: CapabilityProfile,
  feature: string,
): boolean {
  return profile.features.some((fact) => fact.feature === feature && fact.declared);
}

function permissionGranted(
  profile: CapabilityProfile,
  permission: string,
): boolean {
  if (permission === "android.permission.VIBRATE") return true;
  return profile.permissions.some(
    (fact) => fact.permission === permission && fact.granted,
  );
}

function ruleForTest(
  contract: CapabilityContract,
  testId: string,
): CapabilityContract["rules"][number] | undefined {
  return contract.rules.find((rule) => rule.tests.includes(testId));
}

/**
 * Discovery → evidence plan (guideline §8.1 / §8.5).
 * UI status is never PASS before the test runs.
 */
export function planEvidence(
  profile: CapabilityProfile,
  catalog: readonly TestDefinition[] = S1_TEST_CATALOG,
  contract: CapabilityContract = S1_CAPABILITY_CONTRACT,
): PlannedTest[] {
  return catalog.map((test) => planOne(profile, test, contract));
}

function planOne(
  profile: CapabilityProfile,
  test: TestDefinition,
  contract: CapabilityContract,
): PlannedTest {
  const rule = ruleForTest(contract, test.testId);

  if (test.s1ForbiddenPass || rule?.s1ForbiddenPass) {
    return finish(test, {
      readiness: "FORBIDDEN_ON_LAYER",
      uiStatus: "Not available on S1",
      plannedResult: "NOT_AVAILABLE",
      limitation: "LAYER_FORBIDDEN",
    });
  }

  if (test.observationOnly) {
    return finish(test, {
      readiness: "NOT_TESTED",
      uiStatus: "Observation",
      plannedResult: "NOT_TESTED",
    });
  }

  const missingFeature = test.requireFeatures.find(
    (feature) => !featureDeclared(profile, feature),
  );
  if (missingFeature) {
    const result = rule?.missingFeatureResult ?? "NOT_SUPPORTED";
    return finish(test, {
      readiness: "NOT_SUPPORTED",
      uiStatus: "Not supported",
      plannedResult: result,
      limitation:
        result === "NOT_SUPPORTED" ? "HARDWARE_ABSENT" : "FEATURE_UNDECLARED",
    });
  }

  const missingPermission = test.requirePermissions.find(
    (permission) => !permissionGranted(profile, permission),
  );
  if (missingPermission) {
    return finish(test, {
      readiness: "PERMISSION_DENIED",
      uiStatus: "Permission required",
      plannedResult: "PERMISSION_DENIED",
      limitation: "PERMISSION_DENIED",
    });
  }

  return finish(test, {
    readiness: "READY",
    uiStatus: "Ready to test",
    plannedResult: "NOT_TESTED",
  });
}

function finish(
  test: TestDefinition,
  extra: {
    readiness: TestReadiness;
    uiStatus: PlannedTest["uiStatus"];
    plannedResult: EvidenceResult;
    limitation?: LimitationCode;
  },
): PlannedTest {
  return {
    testId: test.testId,
    userName: test.userName,
    objectiveName: test.objectiveName,
    domain: test.domain,
    ...extra,
  };
}
