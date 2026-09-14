package cyvra.mobile.host.transport

import cyvra.mobile.core.EvidenceFieldResult
import cyvra.mobile.core.EvidenceStatus
import kotlinx.serialization.Serializable

typealias HostEvidenceStatus = EvidenceStatus
typealias HostEvidenceFieldResult<T> = EvidenceFieldResult<T>

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
