package cyvra.mobile.host.transport

import kotlinx.serialization.Serializable

@Serializable
enum class EvidenceStatus {
    AVAILABLE,
    NOT_AVAILABLE,
    RESTRICTED,
    PERMISSION_REQUIRED,
    UNSUPPORTED_API,
    OEM_UNSUPPORTED,
    ERROR,
}

@Serializable
data class EvidenceFieldResult<T>(
    val value: T?,
    val status: EvidenceStatus,
    val source: String,
    val reason: String? = null,
    val timestamp: String = java.time.Instant.now().toString(),
)

@Serializable
data class AdbDeviceDescriptor(
    val serial: String,
    val state: String,
    val product: String? = null,
    val model: String? = null,
    val device: String? = null,
    val transportId: String? = null,
)

@Serializable
data class AdbVersionInfo(
    val rawOutput: String,
    val versionString: String,
    val bridgeVersion: String? = null,
    val isControlledDistribution: Boolean = false,
)

@Serializable
data class PreflightCheckItem(
    val checkName: String,
    val pass: Boolean,
    val details: String,
    val isOptional: Boolean = false,
)

@Serializable
data class PreflightResult(
    val readyToScan: Boolean,
    val checks: List<PreflightCheckItem>,
)
