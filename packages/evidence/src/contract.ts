import { SCHEMA_VERSION } from "./vocabulary";
import type { CapabilityContract } from "./types";
import { ANDROID_FEATURES, ANDROID_PERMISSIONS } from "./catalog";

/**
 * Capability contract v1 (guideline §8.5).
 * Data-driven feature flags — never `if (model === "S21")`.
 * Capability ≠ test result.
 */
export const S1_CAPABILITY_CONTRACT: CapabilityContract = {
  schemaVersion: SCHEMA_VERSION,
  contractId: "CYVRA-CC-S1-V1",
  version: "1.0.0",
  layer: "S1",
  rules: [
    {
      capabilityId: "CAP.CAMERA_BACK",
      requireFeatures: [ANDROID_FEATURES.CAMERA],
      tests: ["HW.CAMERA_BACK", "FN.CAMERA_BACK_CAPTURE"],
      requirePermissions: [ANDROID_PERMISSIONS.CAMERA],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
    },
    {
      capabilityId: "CAP.CAMERA_FRONT",
      requireFeatures: [ANDROID_FEATURES.CAMERA_FRONT],
      tests: ["HW.CAMERA_FRONT", "FN.CAMERA_FRONT_CAPTURE"],
      requirePermissions: [ANDROID_PERMISSIONS.CAMERA],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
    },
    {
      capabilityId: "CAP.CAMERA_ANY",
      requireFeatures: [ANDROID_FEATURES.CAMERA_ANY],
      tests: ["HW.CAMERA_INVENTORY"],
      requirePermissions: [ANDROID_PERMISSIONS.CAMERA],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
      notes:
        "Android 10+ Camera2 characteristics that identify the device require CAMERA permission.",
    },
    {
      capabilityId: "CAP.TOUCHSCREEN",
      requireFeatures: [ANDROID_FEATURES.TOUCHSCREEN],
      tests: ["FN.TOUCH_GRID"],
      requirePermissions: [],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
    },
    {
      capabilityId: "CAP.MICROPHONE",
      requireFeatures: [ANDROID_FEATURES.MICROPHONE],
      tests: ["FN.MICROPHONE"],
      requirePermissions: [ANDROID_PERMISSIONS.RECORD_AUDIO],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
    },
    {
      capabilityId: "CAP.AUDIO_OUTPUT",
      requireFeatures: [ANDROID_FEATURES.AUDIO_OUTPUT],
      tests: ["FN.SPEAKER"],
      requirePermissions: [],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
    },
    {
      capabilityId: "CAP.WIFI",
      requireFeatures: [ANDROID_FEATURES.WIFI],
      tests: ["NET.WIFI"],
      requirePermissions: [],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
      notes:
        "S1 classifies Wi-Fi. It must not enable/disable Wi-Fi (WifiManager.setWifiEnabled is a no-op for apps targeting API 29+).",
    },
    {
      capabilityId: "CAP.BLUETOOTH",
      requireFeatures: [ANDROID_FEATURES.BLUETOOTH],
      tests: ["NET.BLUETOOTH"],
      requirePermissions: [ANDROID_PERMISSIONS.BLUETOOTH_CONNECT],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
    },
    {
      capabilityId: "CAP.TELEPHONY",
      requireFeatures: [ANDROID_FEATURES.TELEPHONY],
      tests: ["NET.CELLULAR"],
      requirePermissions: [],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
      notes:
        "Tablets without telephony declare this feature absent. That is NOT_SUPPORTED, not FAIL.",
    },
    {
      capabilityId: "CAP.ACCELEROMETER",
      requireFeatures: [ANDROID_FEATURES.SENSOR_ACCELEROMETER],
      tests: ["FN.ACCELEROMETER"],
      requirePermissions: [],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
    },
    {
      capabilityId: "CAP.GYROSCOPE",
      requireFeatures: [ANDROID_FEATURES.SENSOR_GYROSCOPE],
      tests: ["FN.GYROSCOPE"],
      requirePermissions: [],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
    },
    {
      capabilityId: "CAP.PROXIMITY",
      requireFeatures: [ANDROID_FEATURES.SENSOR_PROXIMITY],
      tests: ["FN.PROXIMITY"],
      requirePermissions: [],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
    },
    {
      capabilityId: "CAP.AMBIENT_LIGHT",
      requireFeatures: [ANDROID_FEATURES.SENSOR_LIGHT],
      tests: ["FN.AMBIENT_LIGHT"],
      requirePermissions: [],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
    },
    {
      capabilityId: "CAP.MAGNETOMETER",
      requireFeatures: [ANDROID_FEATURES.SENSOR_COMPASS],
      tests: ["FN.MAGNETOMETER"],
      requirePermissions: [],
      missingFeatureResult: "NOT_SUPPORTED",
      s1ForbiddenPass: false,
    },
    {
      capabilityId: "CAP.IMEI_SERIAL",
      requireFeatures: [],
      tests: ["IDN.IMEI_SERIAL"],
      requirePermissions: [],
      missingFeatureResult: "NOT_AVAILABLE",
      s1ForbiddenPass: true,
      notes:
        "Android 10+ IMEI/serial require READ_PRIVILEGED_PHONE_STATE. Samsung Knox Configure/Manage only. Not S1.",
    },
    {
      capabilityId: "CAP.BATTERY_SOH",
      requireFeatures: [],
      tests: ["PWR.BATTERY_SOH"],
      requirePermissions: [],
      missingFeatureResult: "NOT_AVAILABLE",
      s1ForbiddenPass: true,
      notes:
        "Battery SOH is Knox Asset Intelligence / flagged BatteryManager API. S1 records battery status only.",
    },
    {
      capabilityId: "CAP.KNOX_ATTESTATION",
      requireFeatures: [],
      tests: ["SEC.KNOX_CLAIM"],
      requirePermissions: [],
      missingFeatureResult: "NOT_AVAILABLE",
      s1ForbiddenPass: true,
      notes:
        "Knox SDK is S3. Android 15+ further restricts Knox methods to Device/Profile Owner.",
    },
  ],
};

export function contractHasModelBranch(contract: CapabilityContract): boolean {
  const blob = JSON.stringify(contract).toLowerCase();
  return /\b(sm-[a-z0-9]+|galaxy s\d+|model\s*===|model\s*==)/i.test(blob);
}
