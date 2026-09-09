import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ANDROID_FEATURES,
  S1_CAPABILITY_CONTRACT,
  S1_TEST_CATALOG,
  SCHEMA_VERSION,
  assertS1Honesty,
  asCapabilityProfileId,
  asDeviceLifecycleId,
  asEvidenceId,
  asProcessingSessionId,
  catalogTestIds,
  classifyConflicts,
  coerceToFail,
  contractHasModelBranch,
  canonicalJson,
  digestCanonical,
  digestRecord,
  isFailure,
  isNonFailure,
  planEvidence,
  validateEvidenceRecord,
  type CapabilityProfile,
  type EvidenceRecord,
} from "../src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const IDS = {
  lifecycle: asDeviceLifecycleId("11111111-1111-4111-8111-111111111111"),
  session: asProcessingSessionId("22222222-2222-4222-8222-222222222222"),
  profile: asCapabilityProfileId("33333333-3333-4333-8333-333333333333"),
  evidence: asEvidenceId("44444444-4444-4444-8444-444444444444"),
};

function feature(name: string, declared: boolean) {
  return {
    feature: name,
    declared,
    state: "DECLARED" as const,
  };
}

function samsungPhone(overrides: Partial<CapabilityProfile> = {}): CapabilityProfile {
  return {
    schemaVersion: SCHEMA_VERSION,
    profileId: IDS.profile,
    deviceLifecycleId: IDS.lifecycle,
    processingSessionId: IDS.session,
    version: 1,
    capturedAt: "2026-09-09T12:00:00.000Z",
    accessLevel: "L2_S1_APP",
    usbState: "USB_DISCONNECTED",
    adbState: "ADB_DISABLED",
    manufacturer: "samsung",
    brand: "samsung",
    model: "generic",
    product: "generic",
    device: "generic",
    fingerprint: "samsung/generic/generic:14/UP1A/1:user/release-keys",
    androidRelease: "14",
    sdkInt: 34,
    smallestScreenWidthDp: 360,
    features: [
      feature(ANDROID_FEATURES.CAMERA, true),
      feature(ANDROID_FEATURES.CAMERA_FRONT, true),
      feature(ANDROID_FEATURES.CAMERA_ANY, true),
      feature(ANDROID_FEATURES.TOUCHSCREEN, true),
      feature(ANDROID_FEATURES.MICROPHONE, true),
      feature(ANDROID_FEATURES.WIFI, true),
      feature(ANDROID_FEATURES.BLUETOOTH, true),
      feature(ANDROID_FEATURES.TELEPHONY, true),
      feature(ANDROID_FEATURES.AUDIO_OUTPUT, true),
      feature(ANDROID_FEATURES.SENSOR_ACCELEROMETER, true),
      feature(ANDROID_FEATURES.SENSOR_GYROSCOPE, true),
      feature(ANDROID_FEATURES.SENSOR_PROXIMITY, true),
      feature(ANDROID_FEATURES.SENSOR_LIGHT, true),
      feature(ANDROID_FEATURES.SENSOR_COMPASS, true),
    ],
    permissions: [{ permission: "android.permission.CAMERA", granted: false }],
    limitations: [],
    ...overrides,
  };
}

function samsungTabletNoSim(): CapabilityProfile {
  const phone = samsungPhone({
    smallestScreenWidthDp: 800,
    features: samsungPhone().features.map((fact) =>
      fact.feature === ANDROID_FEATURES.TELEPHONY
        ? { ...fact, declared: false }
        : fact,
    ),
  });
  return phone;
}

function record(
  partial: Partial<EvidenceRecord> & Pick<EvidenceRecord, "testId" | "result">,
): EvidenceRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    evidenceId: IDS.evidence,
    deviceLifecycleId: IDS.lifecycle,
    processingSessionId: IDS.session,
    source: "S1_APPLICATION",
    collectedAt: "2026-09-09T12:00:00.000Z",
    method: "unit-fixture",
    ...partial,
  };
}

describe("G4 vocabulary", () => {
  it("treats PERMISSION_DENIED as a non-failure", () => {
    assert.equal(isFailure("PERMISSION_DENIED"), false);
    assert.equal(isNonFailure("PERMISSION_DENIED"), true);
    assert.equal(isNonFailure("NOT_AVAILABLE"), true);
    assert.equal(isNonFailure("NOT_SUPPORTED"), true);
    assert.equal(isNonFailure("NOT_TESTED"), true);
    assert.equal(isFailure("FAIL"), true);
  });

  it("refuses to coerce non-failures into FAIL", () => {
    assert.throws(() => coerceToFail("PERMISSION_DENIED"));
    assert.throws(() => coerceToFail("NOT_AVAILABLE"));
  });
});

describe("G4 digest", () => {
  it("canonicalizes key order so pretty JSON is not hashed", async () => {
    const a = { testId: "FN.CAMERA_BACK_CAPTURE", result: "PASS", z: 1 };
    const b = { z: 1, result: "PASS", testId: "FN.CAMERA_BACK_CAPTURE" };
    assert.equal(canonicalJson(a), canonicalJson(b));
    assert.equal(await digestCanonical(a), await digestCanonical(b));
    assert.notEqual(canonicalJson(a), JSON.stringify(a, null, 2));
  });

  it("does not replace collectedAt when hashing a record", async () => {
    const original = record({
      testId: "IDN.BUILD_IDENTITY",
      result: "PASS",
      collectedAt: "2026-09-09T12:00:00.000Z",
    });
    const synced = {
      ...original,
      collectedAt: "2026-09-09T12:00:00.000Z",
      syncedAt: "2026-09-09T18:00:00.000Z",
    };
    const withDigest = {
      ...(original as unknown as Record<string, unknown>),
      digest: "deadbeef",
    };
    assert.equal(
      await digestRecord(original as unknown as Record<string, unknown>),
      await digestRecord(withDigest),
    );
    assert.notEqual(
      await digestCanonical(original),
      await digestCanonical(synced),
    );
  });
});

describe("G4 capability contract", () => {
  it("has no model-name branches", () => {
    assert.equal(contractHasModelBranch(S1_CAPABILITY_CONTRACT), false);
  });

  it("covers every catalog test with a unique TEST_ID", () => {
    const ids = catalogTestIds();
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.length >= 30);
    const domains = new Set(S1_TEST_CATALOG.map((test) => test.domain));
    assert.equal(domains.size, 7);
  });

  it("marks missing camera as NOT_SUPPORTED, not FAIL", () => {
    const profile = samsungPhone({
      features: samsungPhone().features.map((fact) =>
        fact.feature.includes("camera") ? { ...fact, declared: false } : fact,
      ),
    });
    const planned = planEvidence(profile);
    const camera = planned.find((item) => item.testId === "FN.CAMERA_BACK_CAPTURE");
    assert.equal(camera?.readiness, "NOT_SUPPORTED");
    assert.equal(camera?.plannedResult, "NOT_SUPPORTED");
    assert.equal(isFailure(camera!.plannedResult), false);
    assert.equal(camera?.uiStatus, "Not supported");
  });

  it("marks denied camera permission as PERMISSION_DENIED, not FAIL", () => {
    const planned = planEvidence(samsungPhone());
    const camera = planned.find((item) => item.testId === "FN.CAMERA_BACK_CAPTURE");
    assert.equal(camera?.readiness, "PERMISSION_DENIED");
    assert.equal(camera?.plannedResult, "PERMISSION_DENIED");
    assert.equal(isNonFailure(camera!.plannedResult), true);
    assert.equal(camera?.uiStatus, "Permission required");
  });

  it("shows Ready to test, never PASS, before a runnable test runs", () => {
    const profile = samsungPhone({
      permissions: [{ permission: "android.permission.CAMERA", granted: true }],
    });
    const planned = planEvidence(profile);
    const camera = planned.find((item) => item.testId === "FN.CAMERA_BACK_CAPTURE");
    assert.equal(camera?.readiness, "READY");
    assert.equal(camera?.uiStatus, "Ready to test");
    assert.equal(camera?.plannedResult, "NOT_TESTED");
  });

  it("does not treat a tablet without SIM as a defect", () => {
    const planned = planEvidence(samsungTabletNoSim());
    const cellular = planned.find((item) => item.testId === "NET.CELLULAR");
    assert.equal(cellular?.plannedResult, "NOT_SUPPORTED");
    assert.equal(isFailure(cellular!.plannedResult), false);
  });

  it("blocks IMEI, battery SOH, and Knox PASS on S1", () => {
    const planned = planEvidence(samsungPhone());
    for (const testId of ["IDN.IMEI_SERIAL", "PWR.BATTERY_SOH", "SEC.KNOX_CLAIM"]) {
      const item = planned.find((row) => row.testId === testId);
      assert.equal(item?.readiness, "FORBIDDEN_ON_LAYER");
      assert.equal(item?.plannedResult, "NOT_AVAILABLE");
      assert.ok(
        assertS1Honesty(
          record({ testId, result: "PASS" }),
        ).length > 0,
      );
    }
  });
});

describe("G4 evidence records", () => {
  it("validates a honest S1 record and rejects a missing testId", () => {
    const ok = record({ testId: "IDN.BUILD_IDENTITY", result: "PASS" });
    assert.equal(validateEvidenceRecord(ok).length, 0);
    const bad = record({ testId: "", result: "PASS" });
    assert.ok(validateEvidenceRecord(bad).some((issue) => issue.path === "testId"));
  });

  it("preserves raw conflict records and prefers S3 for summary only", () => {
    const s1 = record({
      testId: "HW.CAMERA_BACK",
      result: "LIMITED",
      source: "S1_APPLICATION",
    });
    const s3 = record({
      testId: "HW.CAMERA_BACK",
      result: "PASS",
      source: "S3_ENTERPRISE",
      evidenceId: asEvidenceId("66666666-6666-4666-8666-666666666666"),
    });
    const groups = classifyConflicts([s1, s3]);
    assert.equal(groups[0]?.summarySource, "S3_ENTERPRISE");
    assert.equal(groups[0]?.materialConflict, true);
    assert.equal(groups[0]?.records.length, 2);
  });
});

describe("G4 JSON Schema files", () => {
  it("ships the five v1 schemas with stable $id values", () => {
    const names = [
      "evidence-record.v1.json",
      "evidence-batch.v1.json",
      "capability-profile.v1.json",
      "capability-contract.v1.json",
      "report-manifest.v1.json",
    ];
    for (const name of names) {
      const schema = JSON.parse(
        readFileSync(join(root, "schema", name), "utf8"),
      ) as { $id: string; required?: string[] };
      assert.match(schema.$id, /^https:\/\/mobile\.cyvra\.co\.in\/schema\//);
    }
    const manifest = JSON.parse(
      readFileSync(join(root, "schema", "report-manifest.v1.json"), "utf8"),
    ) as { required: string[] };
    assert.ok(manifest.required.includes("frozenAt"));
  });

  it("exports s1-catalog.v1.json with the same TEST_IDs as the TypeScript catalog", () => {
    const exported = JSON.parse(
      readFileSync(join(root, "schema", "s1-catalog.v1.json"), "utf8"),
    ) as { catalog: Array<{ testId: string }>; contract: { contractId: string } };
    assert.equal(exported.contract.contractId, "CYVRA-CC-S1-V1");
    assert.deepEqual(
      exported.catalog.map((row) => row.testId),
      S1_TEST_CATALOG.map((row) => row.testId),
    );
  });
});
