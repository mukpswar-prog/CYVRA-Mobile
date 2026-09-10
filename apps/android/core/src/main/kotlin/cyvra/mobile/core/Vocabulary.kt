package cyvra.mobile.core

const val SCHEMA_VERSION = "1.0.0"
const val VIBRATE_PERMISSION = "android.permission.VIBRATE"

val NON_FAILURE = setOf(
    "NOT_AVAILABLE",
    "NOT_SUPPORTED",
    "NOT_TESTED",
    "CANCELLED",
    "PERMISSION_DENIED",
)

fun isFailure(result: String): Boolean = result == "FAIL"

fun isNonFailure(result: String): Boolean = result in NON_FAILURE

fun coerceToFail(result: String): String {
    throw IllegalStateException(
        "UNAVAILABLE / NOT_TESTED / NOT_SUPPORTED / PERMISSION_DENIED must not be converted into FAIL (got $result)",
    )
}

val S1_FORBIDDEN_PASS_IDS = setOf(
    "IDN.IMEI_SERIAL",
    "PWR.BATTERY_SOH",
    "SEC.KNOX_CLAIM",
)
