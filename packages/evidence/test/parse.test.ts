import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SCHEMA_VERSION,
  asDeviceLifecycleId,
  asEvidenceBatchId,
  asEvidenceId,
  asProcessingSessionId,
  parseEvidenceBatch,
  parseEvidenceIngest,
  parseEvidenceRecord,
} from "../src/index.ts";

const IDS = {
  lifecycle: asDeviceLifecycleId("11111111-1111-4111-8111-111111111111"),
  session: asProcessingSessionId("22222222-2222-4222-8222-222222222222"),
  evidence: asEvidenceId("44444444-4444-4444-8444-444444444444"),
  batch: asEvidenceBatchId("55555555-5555-4555-8555-555555555555"),
};

const honestRecord = {
  schemaVersion: SCHEMA_VERSION,
  evidenceId: IDS.evidence,
  deviceLifecycleId: IDS.lifecycle,
  processingSessionId: IDS.session,
  testId: "IDN.IMEI_SERIAL",
  source: "S1_APPLICATION",
  result: "NOT_AVAILABLE",
  collectedAt: "2026-09-09T12:00:00.000Z",
  method: "s1-privileged-api-absent",
  limitation: "API_PRIVILEGED",
};

const honestBatch = {
  schemaVersion: SCHEMA_VERSION,
  batchId: IDS.batch,
  deviceLifecycleId: IDS.lifecycle,
  processingSessionId: IDS.session,
  createdAt: "2026-09-09T12:05:00.000Z",
  records: [honestRecord],
};

describe("G5 evidence parse", () => {
  it("parses an honest S1 IMEI NOT_AVAILABLE record", () => {
    const parsed = parseEvidenceRecord(honestRecord);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.testId, "IDN.IMEI_SERIAL");
      assert.equal(parsed.value.result, "NOT_AVAILABLE");
      assert.equal(parsed.value.collectedAt, "2026-09-09T12:00:00.000Z");
    }
  });

  it("rejects a non-UUID evidenceId without throwing", () => {
    const parsed = parseEvidenceRecord({
      ...honestRecord,
      evidenceId: "not-a-uuid",
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.ok(parsed.issues.some((issue) => issue.path === "evidenceId"));
    }
  });

  it("parses a batch and optional profile together", () => {
    const parsed = parseEvidenceIngest({
      ...honestBatch,
      profile: {
        schemaVersion: SCHEMA_VERSION,
        profileId: "33333333-3333-4333-8333-333333333333",
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
        fingerprint: "samsung/generic:14/1",
        androidRelease: "14",
        sdkInt: 34,
        features: [
          { feature: "android.hardware.telephony", declared: true, state: "DECLARED" },
        ],
        permissions: [],
        limitations: ["API_PRIVILEGED"],
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.batch.batchId, IDS.batch);
      assert.equal(parsed.value.profile?.manufacturer, "samsung");
    }
  });

  it("still parses a dishonest IMEI PASS (honesty is a later gate)", () => {
    const parsed = parseEvidenceBatch({
      ...honestBatch,
      records: [{ ...honestRecord, result: "PASS" }],
    });
    assert.equal(parsed.ok, true);
  });
});
