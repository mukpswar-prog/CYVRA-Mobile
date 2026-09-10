import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SCHEMA_VERSION,
  asDeviceLifecycleId,
  asEvidenceId,
  asProcessingSessionId,
  asReportId,
  buildReportEntries,
  catalogTestIds,
  computeCoverage,
  formatReportNumber,
  assembleManifest,
  REPORT_1_TITLE,
  REPORT_1_NONGOALS,
  enrichEntry,
  coverageCaption,
  domainLabel,
  type EvidenceRecord,
  type ManifestEntry,
} from "../src/index.ts";

const lifecycle = asDeviceLifecycleId("11111111-1111-4111-8111-111111111111");
const session = asProcessingSessionId("22222222-2222-4222-8222-222222222222");

function record(
  testId: string,
  result: EvidenceRecord["result"],
  evidenceId: string,
): EvidenceRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    evidenceId: asEvidenceId(evidenceId),
    deviceLifecycleId: lifecycle,
    processingSessionId: session,
    testId,
    source: "S1_APPLICATION",
    result,
    collectedAt: "2026-09-10T12:00:00.000Z",
    method: "unit",
  };
}

describe("G6 Report 1 coverage", () => {
  it("is PARTIAL when catalog tests are missing", () => {
    const entries: ManifestEntry[] = [
      {
        testId: "IDN.IMEI_SERIAL",
        evidenceId: asEvidenceId("44444444-4444-4444-8444-444444444444"),
        result: "NOT_AVAILABLE",
        source: "S1_APPLICATION",
      },
    ];
    assert.equal(computeCoverage(entries), "PARTIAL");
    assert.ok(catalogTestIds().length > 1);
  });

  it("is LIMITED when every catalog test is present but some are withheld", () => {
    const ids = catalogTestIds();
    const entries: ManifestEntry[] = ids.map((testId, index) => ({
      testId,
      evidenceId: asEvidenceId(
        `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, "0")}`,
      ),
      result: testId === "IDN.IMEI_SERIAL" ? "NOT_AVAILABLE" : "PASS",
      source: "S1_APPLICATION",
    }));
    assert.equal(computeCoverage(entries), "LIMITED");
  });

  it("is COMPLETE only when every catalog test is PASS or FAIL", () => {
    const entries: ManifestEntry[] = catalogTestIds().map((testId, index) => ({
      testId,
      evidenceId: asEvidenceId(
        `bbbbbbbb-bbbb-4bbb-8bbb-${index.toString().padStart(12, "0")}`,
      ),
      result: testId.startsWith("SEC.") ? "FAIL" : "PASS",
      source: "S1_APPLICATION",
    }));
    assert.equal(computeCoverage(entries), "COMPLETE");
  });
});

describe("G6 freeze shape", () => {
  it("builds summary entries without inventing a grade", () => {
    const entries = buildReportEntries([
      record("IDN.IMEI_SERIAL", "NOT_AVAILABLE", "44444444-4444-4444-8444-444444444444"),
      record("FN.CAMERA_BACK_CAPTURE", "PERMISSION_DENIED", "55555555-5555-4555-8555-555555555555"),
    ]);
    assert.equal(entries.length, 2);
    assert.ok(entries.every((entry) => entry.result !== "PASS" || entry.testId !== "IDN.IMEI_SERIAL"));
    const imei = entries.find((entry) => entry.testId === "IDN.IMEI_SERIAL");
    assert.equal(imei?.result, "NOT_AVAILABLE");
  });

  it("formats CYVRA-R1-YEAR-UNIQUE and keeps official title / non-goals", () => {
    const reportId = asReportId("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    assert.equal(
      formatReportNumber(reportId, new Date("2026-09-10T00:00:00.000Z")),
      "CYVRA-R1-2026-CCCCCCCC",
    );
    assert.equal(REPORT_1_TITLE, "CYVRA Device Verification Report");
    assert.ok(REPORT_1_NONGOALS.some((line) => line.includes("sanitization")));
    assert.ok(REPORT_1_NONGOALS.some((line) => /certified perfect/i.test(line)));
  });

  it("keeps user name + objective name and coverage captions", () => {
    const entry = enrichEntry({
      testId: "FN.CAMERA_BACK_CAPTURE",
      evidenceId: asEvidenceId("55555555-5555-4555-8555-555555555555"),
      result: "PERMISSION_DENIED",
      source: "S1_APPLICATION",
    });
    assert.equal(entry.userName, "Camera Check");
    assert.equal(entry.objectiveName, "Camera Functional Verification (rear)");
    assert.equal(entry.domain, "FUNCTIONAL_VERIFICATION");
    assert.equal(domainLabel(entry.domain), "Functional verification");
    assert.match(coverageCaption("PARTIAL"), /not a quality grade/i);
    assert.match(coverageCaption("LIMITED"), /withheld/i);
    assert.match(coverageCaption("COMPLETE"), /PASS or FAIL/);
  });

  it("sets frozenAt on assemble", () => {
    const manifest = assembleManifest({
      reportId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      deviceLifecycleId: lifecycle,
      processingSessionId: session,
      records: [
        record("NET.CELLULAR", "NOT_SUPPORTED", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
      ],
      frozenAt: "2026-09-10T12:00:00.000Z",
    });
    assert.equal(manifest.frozenAt, "2026-09-10T12:00:00.000Z");
    assert.equal(manifest.coverage, "PARTIAL");
  });
});
