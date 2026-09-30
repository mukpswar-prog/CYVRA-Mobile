package cyvra.mobile.host.service

import cyvra.mobile.host.license.FileBasedLicenseProvider
import cyvra.mobile.host.license.LicenseFileReason
import cyvra.mobile.host.license.LicenseFileResult
import cyvra.mobile.host.license.LicenseProvider
import cyvra.mobile.host.license.SignedEntitlementProvider

/**
 * Production composition root for the Host (P2/P8).
 *
 * The activated workstation reads `<cyvra.home>/entitlement.json` exactly once,
 * at boot, through the [SignedEntitlementProvider] seam. That provider verifies
 * the server signature before it grants anything, and - because it cannot throw
 * - a missing, unsigned or corrupt snapshot degrades the Host to a denied
 * entitlement instead of preventing startup.
 *
 * `license.json` / [FileBasedLicenseProvider] is deliberately **not** wired
 * here. It remains the test and local-development seam: tests construct it
 * directly, so fixture licences never enter a production code path and an
 * unsigned file on disk can never activate a shipped workstation. There is no
 * property, flag or reset path that switches this composition root back to it.
 *
 * Tests deliberately do NOT go through this object: they construct
 * `HostLicenseService(sampleLicense())` directly, so fixture licences never
 * enter a production code path and this file loader never executes under test.
 */
object HostBootstrap {

    val licenseProvider: LicenseProvider = SignedEntitlementProvider()

    val licenseResult: LicenseFileResult = licenseProvider.load()

    val licenseService: HostLicenseService = HostLicenseService(licenseResult.record)

    /**
     * One-line boot report for stderr. Stdout is reserved for JSON protocol lines, and
     * the workstation spawns the Host with `stderr(Stdio::inherit())`, so this can never
     * corrupt the protocol stream.
     */
    fun describeLicenseState(): String = buildString {
        append("cyvra.license: ")
        append(licenseResult.reason)
        licenseResult.sourcePath?.let {
            append(" (")
            append(it)
            append(")")
        }
        if (licenseResult.cached) {
            append(" - cached server-signed snapshot, verified ")
            append(SignedEntitlementProvider.SCHEMA)
        }
        if (!licenseResult.offline.sanitizeExecute) {
            append(" - destructive sanitization locked by the snapshot")
        }
        if (!licenseResult.isLicensed) {
            append(" - fail-closed: RUN_SCAN must answer LICENSE_REQUIRED")
        }
    }

    /** True when the boot-time entitlement rests on a cached snapshot rather than a live answer. */
    fun isCachedEntitlement(): Boolean = licenseResult.cached

    /** The reason the boot-time licence load gave, for callers that only need the verdict. */
    fun licenseReason(): LicenseFileReason = licenseResult.reason
}
