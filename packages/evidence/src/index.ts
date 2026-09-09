export {
  SCHEMA_VERSION,
  EVIDENCE_RESULTS,
  EVIDENCE_SOURCES,
  COVERAGE_LABELS,
  ACCESS_LEVELS,
  USB_STATES,
  ADB_STATES,
  FACT_STATES,
  REPORT_DOMAINS,
  LIMITATION_CODES,
  SOURCE_SUMMARY_RANK,
  isFailure,
  isNonFailure,
  coerceToFail,
} from "./vocabulary";
export type {
  EvidenceResult,
  EvidenceSource,
  CoverageLabel,
  AccessLevel,
  UsbState,
  AdbState,
  FactState,
  ReportDomain,
  LimitationCode,
} from "./vocabulary";

export {
  ID_KINDS,
  isUuid,
  asProcessingSessionId,
  asDeviceLifecycleId,
  asEvidenceId,
  asReportId,
  asCapabilityProfileId,
  asEvidenceBatchId,
} from "./ids";
export type {
  IdKind,
  ProcessingSessionId,
  DeviceLifecycleId,
  EvidenceId,
  ReportId,
  CapabilityProfileId,
  EvidenceBatchId,
  TestId,
} from "./ids";

export {
  canonicalJson,
  bytesOfCanonical,
  sha256Hex,
  digestCanonical,
  digestRecord,
} from "./digest";

export {
  ANDROID_FEATURES,
  ANDROID_PERMISSIONS,
  S1_TEST_CATALOG,
  getTestDefinition,
  catalogTestIds,
} from "./catalog";

export { S1_CAPABILITY_CONTRACT, contractHasModelBranch } from "./contract";
export { planEvidence } from "./plan";
export { classifyConflicts } from "./conflict";
export type { ConflictGroup } from "./conflict";
export { assertS1Honesty, recordIsHonest } from "./honesty";
export {
  validateEvidenceRecord,
  validateEvidenceBatch,
  validateReportManifest,
  isEvidenceResult,
  isEvidenceSource,
} from "./validate";
export type { ValidationIssue } from "./validate";

export type {
  AndroidFeatureFact,
  PermissionFact,
  CapabilityProfile,
  TestDefinition,
  CapabilityRule,
  CapabilityContract,
  TestReadiness,
  PlannedTest,
  EvidenceRecord,
  EvidenceBatch,
  ManifestEntry,
  ReportManifest,
  HonestyIssue,
} from "./types";
