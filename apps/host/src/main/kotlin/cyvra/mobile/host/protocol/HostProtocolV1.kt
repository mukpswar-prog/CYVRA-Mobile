package cyvra.mobile.host.protocol

object HostProtocolV1 {
    const val VERSION = "1"
    const val DEFAULT_HOST_VERSION = "0.0.0"
}

enum class HostCommand {
    GET_HOST_INFO,
    GET_PREFLIGHT,
    GET_DEVICE_STATE,
}

enum class HostResponseStatus {
    OK,
    ERROR,
}
