import type {
  AccessLevel,
  AdbState,
  CoverageLabel,
  EvidenceResult,
  EvidenceSource,
  FactState,
  LimitationCode,
  ReportDomain,
  UsbState,
} from "./vocabulary";
import type {
  CapabilityProfileId,
  DeviceLifecycleId,
  EvidenceBatchId,
  EvidenceId,
  ProcessingSessionId,
  ReportId,
} from "./ids";

export interface AndroidFeatureFact {
  feature: string;
  declared: boolean;
  detected?: boolean;
  state: FactState;
}

export interface PermissionFact {
  permission: string;
  granted: boolean;
}

/**
 * Device Capability Profile snapshot (guideline §8.1).
 * A state change creates a new version; previous versions are kept.
 */
export interface CapabilityProfile {
  schemaVersion: string;
  profileId: CapabilityProfileId;
  deviceLifecycleId: DeviceLifecycleId;
  processingSessionId: ProcessingSessionId;
  version: number;
  capturedAt: string;
  accessLevel: AccessLevel;
  usbState: UsbState;
  adbState: AdbState;
  manufacturer: string;
  brand: string;
  model: string;
  product: string;
  device: string;
  fingerprint: string;
  androidRelease: string;
  sdkInt: number;
  smallestScreenWidthDp?: number;
  features: AndroidFeatureFact[];
  permissions: PermissionFact[];
  limitations: LimitationCode[];
}

export interface TestDefinition {
  testId: string;
  domain: ReportDomain;
  /** User-facing short name (guideline §8.7 / §8.8). Not a database key. */
  userName: string;
  /** Objective name kept in app, Station, API, and PDF. */
  objectiveName: string;
  /** Android PackageManager feature strings. Empty = always potentially runnable. */
  requireFeatures: string[];
  /** Runtime permissions requested when the test starts. */
  requirePermissions: string[];
  /** Minimum evidence source that may honestly run this test. */
  minSource: EvidenceSource;
  /** If true, S1 must not emit PASS. */
  s1ForbiddenPass: boolean;
  /** Default result when the test has not been run. */
  defaultUntested: Extract<EvidenceResult, "NOT_TESTED">;
  observationOnly?: boolean;
}

export interface CapabilityRule {
  capabilityId: string;
  /** PackageManager feature flags. Data-driven — never model name equals. */
  requireFeatures: string[];
  tests: string[];
  requirePermissions: string[];
  missingFeatureResult: Extract<
    EvidenceResult,
    "NOT_SUPPORTED" | "NOT_AVAILABLE"
  >;
  s1ForbiddenPass: boolean;
  notes?: string;
}

export interface CapabilityContract {
  schemaVersion: string;
  contractId: string;
  version: string;
  layer: "S1";
  rules: CapabilityRule[];
}

export type TestReadiness =
  | "READY"
  | "NOT_SUPPORTED"
  | "PERMISSION_DENIED"
  | "FORBIDDEN_ON_LAYER"
  | "NOT_TESTED";

export interface PlannedTest {
  testId: string;
  userName: string;
  objectiveName: string;
  domain: ReportDomain;
  readiness: TestReadiness;
  /** UI must show Ready to test, never PASS, before the test runs. */
  uiStatus: "Ready to test" | "Not supported" | "Permission required" | "Not available on S1" | "Observation";
  plannedResult: EvidenceResult;
  limitation?: LimitationCode;
}

export interface EvidenceRecord {
  schemaVersion: string;
  evidenceId: EvidenceId;
  deviceLifecycleId: DeviceLifecycleId;
  processingSessionId: ProcessingSessionId;
  capabilityProfileId?: CapabilityProfileId;
  testId: string;
  source: EvidenceSource;
  result: EvidenceResult;
  collectedAt: string;
  method: string;
  limitation?: LimitationCode;
  notes?: string;
  payload?: Record<string, unknown>;
  digest?: string;
}

export interface EvidenceBatch {
  schemaVersion: string;
  batchId: EvidenceBatchId;
  deviceLifecycleId: DeviceLifecycleId;
  processingSessionId: ProcessingSessionId;
  records: EvidenceRecord[];
  createdAt: string;
}

export interface ManifestEntry {
  testId: string;
  evidenceId: EvidenceId;
  result: EvidenceResult;
  source: EvidenceSource;
}

/**
 * Report 1 freeze shape (guideline §8.6). G4 defines the type.
 * `frozenAt` is set at G6; until then it stays null.
 */
export interface ReportManifest {
  schemaVersion: string;
  reportId: ReportId;
  deviceLifecycleId: DeviceLifecycleId;
  processingSessionId: ProcessingSessionId;
  coverage: CoverageLabel;
  entries: ManifestEntry[];
  frozenAt: string | null;
}

export interface HonestyIssue {
  testId: string;
  reason: string;
}
