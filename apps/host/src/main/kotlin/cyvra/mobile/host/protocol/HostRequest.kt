package cyvra.mobile.host.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class HostRequest(
    val protocolVersion: String,
    val requestId: String,
    val command: HostCommand,
    val payload: JsonObject = JsonObject(emptyMap()),
)
