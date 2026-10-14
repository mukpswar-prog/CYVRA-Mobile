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

    /**
     * Runs the §7 finalisation chain — normalise → operator authorisation → seal → final
     * controlled report — entirely inside this Host, with no web surface required.
     *
     * It never writes to a device and never starts a sanitization lifecycle, so it moves
     * **no entitlement**: finalising a report this workstation already produced is not a
     * second scan and not a certificate. It observes nothing new; it finalises what is
     * already held.
     */
    FINALISE_REPORT,

    /**
     * Read-only catalogue of the technician checklist: the 14 physical and specialist
     * checks that no collector in this product can establish.
     *
     * Answers what `TechnicianChecklistCatalog` holds, plus the progress of whatever has
     * been recorded this session. It records no result and writes nothing to a device, so
     * the UI can render the checklist before a scan exists.
     *
     * Additive to protocol 1 rather than a version bump: an older peer simply never
     * sends these, and nothing already on the wire changes shape.
     */
    GET_CHECKLIST,

    /**
     * Records a technician's answers as an OPERATOR attestation against that checklist.
     *
     * Requires a completed scan, because an attestation must belong to a real session,
     * and carries an author, because an attestation with no author is not evidence. The
     * `source` is fixed to `OPERATOR` inside the model: a human opinion can never reach
     * the report shaped like a software observation, which is the specific failure the
     * four-plane attribution rule exists to prevent.
     */
    RECORD_CHECKLIST,
}

enum class HostResponseStatus {
    OK,
    ERROR,
}
