package cyvra.mobile.host.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class HostError(
    val code: String,
    val message: String,
)

@Serializable
data class HostResponse(
    val protocolVersion: String,
    val requestId: String,
    val status: HostResponseStatus,
    val hostVersion: String,
    val payload: JsonObject = JsonObject(emptyMap()),
    val error: HostError? = null,
)
