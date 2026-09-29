package cyvra.mobile.host.protocol

object HostProtocolV1 {
    const val VERSION = "1"
    const val DEFAULT_HOST_VERSION = "0.0.0"
}

enum class HostCommand {
    GET_HOST_INFO,
    GET_PREFLIGHT,
    GET_DEVICE_STATE,

    /**
     * Read-only licence truth for the first-run wizard and the runtime status card.
     *
     * Answers what `FileBasedLicenseProvider` found on disk; it can neither create
     * nor complete an activation.
     */
    GET_LICENSE_STATE,

    /**
     * Read-only inventory of the phones this workstation can currently see over ADB.
     *
     * One entry per device ADB reports, carrying only values the Host actually read:
     * a missing model, make or IMEI is reported as a reason instead of being guessed.
     * The command never writes to a device and never starts a session.
     */
    GET_CONNECTED_DEVICES,

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
