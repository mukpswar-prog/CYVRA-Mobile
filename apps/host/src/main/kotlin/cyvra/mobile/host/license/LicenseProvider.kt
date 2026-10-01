package cyvra.mobile.host.license

/**
 * The single seam through which the Host decides whether this workstation is
 * entitled to run a chargeable operation.
 *
 * Two implementations exist and they are deliberately not interchangeable at
 * runtime:
 *
 *  - [SignedEntitlementProvider] is the production source. It reads the
 *    server-signed `entitlement.json` the Rust layer exports, verifies the
 *    signature against the bundled server public key, and fails closed on any
 *    defect.
 *  - `FileBasedLicenseProvider` reads `license.json`. It is kept purely as the
 *    test/dev seam: production composition ([cyvra.mobile.host.service.HostBootstrap])
 *    never constructs it, so an unsigned file on disk cannot activate a shipped
 *    workstation.
 *
 * Both return [LicenseFileResult], which is the only currency the protocol
 * layer understands: a usable record plus a reason that says whether that
 * record actually entitles anybody.
 */
interface LicenseProvider {

    /**
     * Loads the entitlement, never throwing.
     *
     * A missing, unreadable, unsigned, tampered or expired source must degrade
     * to a denied [LicenseFileResult] rather than to an exception, so the Host
     * always boots and always tells the truth about why it is not licensed.
     */
    fun load(): LicenseFileResult
}

/**
 * What an entitlement snapshot is still allowed to do when it is running from
 * the cached copy the server signed rather than from a live server answer.
 *
 * These values are server-authoritative: they are read out of the signed
 * snapshot, never out of local configuration, so a workstation that is offline
 * cannot widen its own permissions. Defaults on [LicenseFileResult] are
 * permissive only for the `license.json` test/dev seam, which has no snapshot
 * to be restricted by.
 */
data class OfflinePermissions(
    /** Device diagnostics may run (verification stays available offline). */
    val diagnostics: Boolean,
    /** Destructive sanitization may execute. Server says no while offline. */
    val sanitizeExecute: Boolean,
    /** Commercial upgrade may start. Server says no while offline. */
    val upgrade: Boolean,
) {
    companion object {
        /**
         * No offline snapshot governs the caller, so nothing is offline-restricted.
         * Used by the `license.json` test/dev seam so existing behaviour is unchanged.
         */
        val UNRESTRICTED: OfflinePermissions = OfflinePermissions(
            diagnostics = true,
            sanitizeExecute = true,
            upgrade = true,
        )

        /** Fail-closed: with no readable snapshot, nothing at all is permitted. */
        val NONE: OfflinePermissions = OfflinePermissions(
            diagnostics = false,
            sanitizeExecute = false,
            upgrade = false,
        )
    }
}
