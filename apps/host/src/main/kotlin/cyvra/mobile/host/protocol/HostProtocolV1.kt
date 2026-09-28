package cyvra.mobile.host.protocol

object HostProtocolV1 {
    const val VERSION = "1"
    const val DEFAULT_HOST_VERSION = "0.0.0"
}

enum class HostCommand {
    GET_HOST_INFO,
    GET_PREFLIGHT,
    GET_DEVICE_STATE,

    // P2 workflow: scan -> reports -> sanitization lifecycle.
    RUN_SCAN,
    GET_DEVICE_REPORT,
    GET_APPLICATION_INVENTORY,
    EXPORT_REPORT,
    SANITIZE_START,
    SANITIZE_AUTHORIZE,
    SANITIZE_CONFIRM,
    SANITIZE_EXECUTE,
    SANITIZE_VERIFY,
    GET_FINAL_REPORT,
}

enum class HostResponseStatus {
    OK,
    ERROR,
}
