package cyvra.mobile.host.service

import cyvra.mobile.host.license.FileBasedLicenseProvider
import cyvra.mobile.host.license.LicenseFileResult

/**
 * Production composition root for the Host (P2).
 *
 * The installed workstation reads `<cyvra.home>/license.json` exactly once, at boot,
 * through [FileBasedLicenseProvider]. Because that loader cannot throw, a missing or
 * corrupt file degrades the Host to a denied entitlement instead of preventing startup.
 *
 * Tests deliberately do NOT go through this object: they construct
 * `HostLicenseService(sampleLicense())` directly, so fixture licences never enter a
 * production code path and this file loader never executes under test.
 */
object HostBootstrap {

    val licenseProvider: FileBasedLicenseProvider = FileBasedLicenseProvider()

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
        if (!licenseResult.isLicensed) {
            append(" - fail-closed: RUN_SCAN must answer LICENSE_REQUIRED")
        }
    }
}
