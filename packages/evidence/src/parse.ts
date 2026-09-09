import {
  asCapabilityProfileId,
  asDeviceLifecycleId,
  asEvidenceBatchId,
  asEvidenceId,
  asProcessingSessionId,
  isUuid,
} from "./ids";
import type {
  AndroidFeatureFact,
  CapabilityProfile,
  EvidenceBatch,
  EvidenceRecord,
  PermissionFact,
} from "./types";
import {
  validateEvidenceBatch,
  validateEvidenceRecord,
  type ValidationIssue,
} from "./validate";
import {
  ACCESS_LEVELS,
  ADB_STATES,
  EVIDENCE_RESULTS,
  EVIDENCE_SOURCES,
  FACT_STATES,
  LIMITATION_CODES,
  SCHEMA_VERSION,
  USB_STATES,
  type AccessLevel,
  type AdbState,
  type EvidenceResult,
  type EvidenceSource,
  type FactState,
  type LimitationCode,
  type UsbState,
} from "./vocabulary";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

export interface EvidenceIngestRequest {
  batch: EvidenceBatch;
  profile?: CapabilityProfile;
}

const RESULT_SET = new Set<string>(EVIDENCE_RESULTS);
const SOURCE_SET = new Set<string>(EVIDENCE_SOURCES);
const LIMITATION_SET = new Set<string>(LIMITATION_CODES);
const ACCESS_SET = new Set<string>(ACCESS_LEVELS);
const USB_SET = new Set<string>(USB_STATES);
const ADB_SET = new Set<string>(ADB_STATES);
const FACT_SET = new Set<string>(FACT_STATES);
const DIGEST_RE = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail<T>(issues: ValidationIssue[]): ParseResult<T> {
  return { ok: false, issues };
}

function prefixIssues(
  issues: ValidationIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path ? `${prefix}.${issue.path}` : prefix,
    message: issue.message,
  }));
}

function readString(
  input: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
): string | undefined {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    issues.push({ path: key, message: "required string" });
    return undefined;
  }
  return value;
}

function readOptionalString(
  input: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    issues.push({ path: key, message: "must be a string" });
    return undefined;
  }
  return value;
}

function readUuid(
  input: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
): string | undefined {
  const value = readString(input, key, issues);
  if (value === undefined) return undefined;
  if (!isUuid(value)) {
    issues.push({ path: key, message: "must be UUID" });
    return undefined;
  }
  return value;
}

function readEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: Set<string>,
  issues: ValidationIssue[],
): T | undefined {
  const value = readString(input, key, issues);
  if (value === undefined) return undefined;
  if (!allowed.has(value)) {
    issues.push({ path: key, message: "unknown value" });
    return undefined;
  }
  return value as T;
}

function readInteger(
  input: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
): number | undefined {
  const value = input[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.push({ path: key, message: "must be an integer" });
    return undefined;
  }
  return value;
}

export function parseEvidenceRecord(input: unknown): ParseResult<EvidenceRecord> {
  if (!isRecord(input)) {
    return fail([{ path: "", message: "record must be an object" }]);
  }
  const issues: ValidationIssue[] = [];
  const schemaVersion = readString(input, "schemaVersion", issues);
  const evidenceId = readUuid(input, "evidenceId", issues);
  const deviceLifecycleId = readUuid(input, "deviceLifecycleId", issues);
  const processingSessionId = readUuid(input, "processingSessionId", issues);
  const testId = readString(input, "testId", issues);
  const source = readEnum<EvidenceSource>(input, "source", SOURCE_SET, issues);
  const result = readEnum<EvidenceResult>(input, "result", RESULT_SET, issues);
  const collectedAt = readString(input, "collectedAt", issues);
  const method = readString(input, "method", issues);
  const limitation = input.limitation
    ? readEnum<LimitationCode>(input, "limitation", LIMITATION_SET, issues)
    : undefined;
  const notes = readOptionalString(input, "notes", issues);
  const digest = readOptionalString(input, "digest", issues);
  if (digest !== undefined && !DIGEST_RE.test(digest)) {
    issues.push({ path: "digest", message: "must be 64 lowercase hex chars" });
  }

  let capabilityProfileId: string | undefined;
  if (input.capabilityProfileId !== undefined) {
    capabilityProfileId = readUuid(input, "capabilityProfileId", issues);
  }

  let payload: Record<string, unknown> | undefined;
  if (input.payload !== undefined) {
    if (!isRecord(input.payload)) {
      issues.push({ path: "payload", message: "must be an object" });
    } else {
      payload = input.payload;
    }
  }

  if (issues.length > 0 || !schemaVersion || !evidenceId || !deviceLifecycleId || !processingSessionId || !testId || !source || !result || !collectedAt || !method) {
    return fail(issues);
  }

  const record: EvidenceRecord = {
    schemaVersion,
    evidenceId: asEvidenceId(evidenceId),
    deviceLifecycleId: asDeviceLifecycleId(deviceLifecycleId),
    processingSessionId: asProcessingSessionId(processingSessionId),
    testId,
    source,
    result,
    collectedAt,
    method,
  };
  if (capabilityProfileId) {
    record.capabilityProfileId = asCapabilityProfileId(capabilityProfileId);
  }
  if (limitation) record.limitation = limitation;
  if (notes !== undefined) record.notes = notes;
  if (payload) record.payload = payload;
  if (digest) record.digest = digest;

  const validation = validateEvidenceRecord(record);
  if (validation.length > 0) return fail(validation);
  return { ok: true, value: record };
}

export function parseEvidenceBatch(input: unknown): ParseResult<EvidenceBatch> {
  if (!isRecord(input)) {
    return fail([{ path: "", message: "batch must be an object" }]);
  }
  const issues: ValidationIssue[] = [];
  const schemaVersion = readString(input, "schemaVersion", issues);
  const batchId = readUuid(input, "batchId", issues);
  const deviceLifecycleId = readUuid(input, "deviceLifecycleId", issues);
  const processingSessionId = readUuid(input, "processingSessionId", issues);
  const createdAt = readString(input, "createdAt", issues);

  if (!Array.isArray(input.records)) {
    issues.push({ path: "records", message: "must be an array" });
    return fail(issues);
  }

  const records: EvidenceRecord[] = [];
  input.records.forEach((raw, index) => {
    const parsed = parseEvidenceRecord(raw);
    if (!parsed.ok) {
      issues.push(...prefixIssues(parsed.issues, `records[${index}]`));
      return;
    }
    records.push(parsed.value);
  });

  if (issues.length > 0 || !schemaVersion || !batchId || !deviceLifecycleId || !processingSessionId || !createdAt) {
    return fail(issues);
  }

  const batch: EvidenceBatch = {
    schemaVersion,
    batchId: asEvidenceBatchId(batchId),
    deviceLifecycleId: asDeviceLifecycleId(deviceLifecycleId),
    processingSessionId: asProcessingSessionId(processingSessionId),
    records,
    createdAt,
  };
  const validation = validateEvidenceBatch(batch);
  if (validation.length > 0) return fail(validation);
  return { ok: true, value: batch };
}

function parseFeatureFact(
  input: unknown,
  path: string,
): ParseResult<AndroidFeatureFact> {
  if (!isRecord(input)) {
    return fail([{ path, message: "must be an object" }]);
  }
  const issues: ValidationIssue[] = [];
  const feature = readString(input, "feature", issues);
  const state = readEnum<FactState>(input, "state", FACT_SET, issues);
  if (typeof input.declared !== "boolean") {
    issues.push({ path: "declared", message: "must be a boolean" });
  }
  if (input.detected !== undefined && typeof input.detected !== "boolean") {
    issues.push({ path: "detected", message: "must be a boolean" });
  }
  if (issues.length > 0 || !feature || !state) {
    return fail(prefixIssues(issues, path));
  }
  const fact: AndroidFeatureFact = {
    feature,
    declared: input.declared as boolean,
    state,
  };
  if (typeof input.detected === "boolean") fact.detected = input.detected;
  return { ok: true, value: fact };
}

function parsePermissionFact(
  input: unknown,
  path: string,
): ParseResult<PermissionFact> {
  if (!isRecord(input)) {
    return fail([{ path, message: "must be an object" }]);
  }
  const issues: ValidationIssue[] = [];
  const permission = readString(input, "permission", issues);
  if (typeof input.granted !== "boolean") {
    issues.push({ path: "granted", message: "must be a boolean" });
  }
  if (issues.length > 0 || !permission) {
    return fail(prefixIssues(issues, path));
  }
  return {
    ok: true,
    value: { permission, granted: input.granted as boolean },
  };
}

export function parseCapabilityProfile(
  input: unknown,
): ParseResult<CapabilityProfile> {
  if (!isRecord(input)) {
    return fail([{ path: "", message: "profile must be an object" }]);
  }
  const issues: ValidationIssue[] = [];
  const schemaVersion = readString(input, "schemaVersion", issues);
  const profileId = readUuid(input, "profileId", issues);
  const deviceLifecycleId = readUuid(input, "deviceLifecycleId", issues);
  const processingSessionId = readUuid(input, "processingSessionId", issues);
  const version = readInteger(input, "version", issues);
  const capturedAt = readString(input, "capturedAt", issues);
  const accessLevel = readEnum<AccessLevel>(
    input,
    "accessLevel",
    ACCESS_SET,
    issues,
  );
  const usbState = readEnum<UsbState>(input, "usbState", USB_SET, issues);
  const adbState = readEnum<AdbState>(input, "adbState", ADB_SET, issues);
  const manufacturer = readString(input, "manufacturer", issues);
  const brand = readString(input, "brand", issues);
  const model = readString(input, "model", issues);
  const product = readString(input, "product", issues);
  const device = readString(input, "device", issues);
  const fingerprint = readString(input, "fingerprint", issues);
  const androidRelease = readString(input, "androidRelease", issues);
  const sdkInt = readInteger(input, "sdkInt", issues);

  if (!Array.isArray(input.features)) {
    issues.push({ path: "features", message: "must be an array" });
  }
  if (!Array.isArray(input.permissions)) {
    issues.push({ path: "permissions", message: "must be an array" });
  }
  if (!Array.isArray(input.limitations)) {
    issues.push({ path: "limitations", message: "must be an array" });
  }

  const features: AndroidFeatureFact[] = [];
  if (Array.isArray(input.features)) {
    input.features.forEach((raw, index) => {
      const parsed = parseFeatureFact(raw, `features[${index}]`);
      if (!parsed.ok) {
        issues.push(...parsed.issues);
        return;
      }
      features.push(parsed.value);
    });
  }

  const permissions: PermissionFact[] = [];
  if (Array.isArray(input.permissions)) {
    input.permissions.forEach((raw, index) => {
      const parsed = parsePermissionFact(raw, `permissions[${index}]`);
      if (!parsed.ok) {
        issues.push(...parsed.issues);
        return;
      }
      permissions.push(parsed.value);
    });
  }

  const limitations: LimitationCode[] = [];
  if (Array.isArray(input.limitations)) {
    input.limitations.forEach((raw, index) => {
      if (typeof raw !== "string" || !LIMITATION_SET.has(raw)) {
        issues.push({
          path: `limitations[${index}]`,
          message: "unknown limitation",
        });
        return;
      }
      limitations.push(raw as LimitationCode);
    });
  }

  let smallestScreenWidthDp: number | undefined;
  if (input.smallestScreenWidthDp !== undefined) {
    smallestScreenWidthDp = readInteger(input, "smallestScreenWidthDp", issues);
  }

  if (
    issues.length > 0 ||
    !schemaVersion ||
    schemaVersion !== SCHEMA_VERSION ||
    !profileId ||
    !deviceLifecycleId ||
    !processingSessionId ||
    version === undefined ||
    !capturedAt ||
    !accessLevel ||
    !usbState ||
    !adbState ||
    !manufacturer ||
    !brand ||
    !model ||
    !product ||
    !device ||
    !fingerprint ||
    !androidRelease ||
    sdkInt === undefined
  ) {
    if (schemaVersion && schemaVersion !== SCHEMA_VERSION) {
      issues.push({
        path: "schemaVersion",
        message: `expected ${SCHEMA_VERSION}`,
      });
    }
    return fail(issues);
  }

  const profile: CapabilityProfile = {
    schemaVersion,
    profileId: asCapabilityProfileId(profileId),
    deviceLifecycleId: asDeviceLifecycleId(deviceLifecycleId),
    processingSessionId: asProcessingSessionId(processingSessionId),
    version,
    capturedAt,
    accessLevel,
    usbState,
    adbState,
    manufacturer,
    brand,
    model,
    product,
    device,
    fingerprint,
    androidRelease,
    sdkInt,
    features,
    permissions,
    limitations,
  };
  if (smallestScreenWidthDp !== undefined) {
    profile.smallestScreenWidthDp = smallestScreenWidthDp;
  }
  return { ok: true, value: profile };
}

/** POST /evidence/batches body: G4 batch fields plus optional `profile`. */
export function parseEvidenceIngest(
  input: unknown,
): ParseResult<EvidenceIngestRequest> {
  const batch = parseEvidenceBatch(input);
  if (!batch.ok) return batch;

  if (!isRecord(input) || input.profile === undefined) {
    return { ok: true, value: { batch: batch.value } };
  }

  const profile = parseCapabilityProfile(input.profile);
  if (!profile.ok) {
    return fail(prefixIssues(profile.issues, "profile"));
  }
  return { ok: true, value: { batch: batch.value, profile: profile.value } };
}
