package cyvra.mobile.host.license

import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.core.ScanCommitStatus
import cyvra.mobile.host.service.HostBootstrap
import cyvra.mobile.host.service.HostLicenseService
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Fail-closed guarantees for the production licence loader (P2).
 *
 * The Host must boot on a machine with no licence file at all, and must never be able
 * to present an absent, unreadable or corrupt file as an entitlement. Every case below
 * asserts the *record* is still usable, because `HostLicenseService` requires one.
 */
class FileBasedLicenseProviderTest {

    private fun tempDir(prefix: String): File =
        Files.createTempDirectory(prefix).toFile()

    private fun providerFor(home: String?): FileBasedLicenseProvider =
        FileBasedLicenseProvider(homeProvider = { home })

    private fun writeLicense(home: File, body: String): File {
        home.mkdirs()
        val file = File(home, FileBasedLicenseProvider.LICENSE_FILE_NAME)
        file.writeText(body)
        return file
    }

    private fun validLicenseJson(): String = """
        {
          "licenseId": "LIC-MOB-2026-00124",
          "serialNumber": "CYVRA15092026SA3F1-1-25",
          "customerEmail": "customer@example.com",
          "planName": "25 Device Scans",
          "deviceScanEntitlement": 25,
          "scansUsed": 3,
          "scansRemaining": 22,
          "revision": 1,
          "status": "ACTIVE"
        }
    """.trimIndent()

    private fun assertDenied(result: LicenseFileResult) {
        assertFalse(result.isLicensed, "expected a fail-closed result, got ${result.reason}")
        assertEquals(0, result.record.scansRemaining, "denied record must hold no balance")
        assertEquals(0, result.record.deviceScanEntitlement, "denied record must hold no entitlement")
        assertEquals(
            LicenseEntitlementStatus.UNKNOWN,
            result.record.status,
            "absent licence state must be reported as UNKNOWN, never as ACTIVE",
        )
        assertEquals("UNLICENSED", result.record.licenseId)
        assertEquals(
            "",
            result.record.lastVerifiedAt,
            "no verification occurred, so none may be claimed",
        )
    }

    @Test
    fun `absent or blank installation home fails closed without throwing`() {
        val missing = providerFor(null).load()
        assertEquals(LicenseFileReason.HOME_PROPERTY_MISSING, missing.reason)
        assertDenied(missing)
        assertNull(missing.sourcePath)

        val blank = providerFor("   ").load()
        assertEquals(LicenseFileReason.HOME_PROPERTY_MISSING, blank.reason)
        assertDenied(blank)
    }

    @Test
    fun `missing license file is reported rather than fabricated`() {
        val home = tempDir("cyvra-license-absent")

        val result = providerFor(home.absolutePath).load()

        assertEquals(LicenseFileReason.FILE_MISSING, result.reason)
        assertDenied(result)
        assertTrue(result.sourcePath!!.endsWith(FileBasedLicenseProvider.LICENSE_FILE_NAME))
    }

    @Test
    fun `malformed json fails closed`() {
        val home = tempDir("cyvra-license-malformed")
        writeLicense(home, "{ this is not json")

        val result = providerFor(home.absolutePath).load()

        assertEquals(LicenseFileReason.INVALID, result.reason)
        assertDenied(result)
    }

    @Test
    fun `a missing mandatory field fails closed`() {
        val home = tempDir("cyvra-license-incomplete")
        writeLicense(
            home,
            """
            {
              "licenseId": "LIC-MOB-2026-00124",
              "serialNumber": "CYVRA15092026SA3F1-1-25",
              "customerEmail": "customer@example.com",
              "planName": "25 Device Scans",
              "deviceScanEntitlement": 25,
              "scansUsed": 3
            }
            """.trimIndent(),
        )

        val result = providerFor(home.absolutePath).load()

        assertEquals(LicenseFileReason.INVALID, result.reason)
        assertDenied(result)
    }

    @Test
    fun `an impossible balance fails closed`() {
        val home = tempDir("cyvra-license-negative")
        writeLicense(home, validLicenseJson().replace("\"scansRemaining\": 22", "\"scansRemaining\": -1"))

        val result = providerFor(home.absolutePath).load()

        assertEquals(LicenseFileReason.INVALID, result.reason)
        assertDenied(result)
    }

    @Test
    fun `a directory standing in for the file fails closed`() {
        val home = tempDir("cyvra-license-unreadable")
        val notAFile = File(home, FileBasedLicenseProvider.LICENSE_FILE_NAME)
        assertTrue(notAFile.mkdirs())

        val result = providerFor(home.absolutePath).load()

        assertEquals(LicenseFileReason.UNREADABLE, result.reason)
        assertDenied(result)
    }

    @Test
    fun `a well formed file loads the real entitlement and can commit a scan`() {
        val home = tempDir("cyvra-license-valid")
        val written = writeLicense(home, validLicenseJson())

        val result = providerFor(home.absolutePath).load()

        assertEquals(LicenseFileReason.LOADED, result.reason)
        assertTrue(result.isLicensed)
        assertEquals(written.absolutePath, result.sourcePath)
        assertEquals("LIC-MOB-2026-00124", result.record.licenseId)
        assertEquals(22, result.record.scansRemaining)
        assertEquals(LicenseEntitlementStatus.ACTIVE, result.record.status)

        val transaction = HostLicenseService(result.record)
            .commitScanForSession("SESSION-VALID", "RF8R123456")
        assertEquals(ScanCommitStatus.COMMITTED, transaction.status)
    }

    @Test
    fun `a licence written with a UTF-8 BOM still loads`() {
        val home = tempDir("cyvra-license-bom")
        val file = File(home, FileBasedLicenseProvider.LICENSE_FILE_NAME)
        file.writeText("\uFEFF" + validLicenseJson())

        val result = providerFor(home.absolutePath).load()

        assertEquals(LicenseFileReason.LOADED, result.reason)
        assertTrue(result.isLicensed)
        assertEquals(22, result.record.scansRemaining)

        // Stripping the mark must not launder a corrupt file into an entitlement.
        file.writeText("\uFEFF{ this is not json")
        val corrupt = providerFor(home.absolutePath).load()
        assertEquals(LicenseFileReason.INVALID, corrupt.reason)
        assertDenied(corrupt)
    }

    @Test
    fun `unknown future keys do not deny a valid licence`() {
        val home = tempDir("cyvra-license-forward")
        writeLicense(
            home,
            validLicenseJson().replace(
                "\"revision\": 1,",
                "\"revision\": 1,\n  \"tier\": \"gold\",\n  \"seats\": 4,",
            ),
        )

        val result = providerFor(home.absolutePath).load()

        assertEquals(LicenseFileReason.LOADED, result.reason)
        assertTrue(result.isLicensed)
    }

    @Test
    fun `a denied record cannot commit a scan`() {
        val denied = providerFor(null).load()

        val service = HostLicenseService(denied.record)

        assertFailsWith<IllegalStateException> {
            service.commitScanForSession("SESSION-DENIED", "RF8R123456")
        }
    }

    @Test
    fun `production bootstrap always yields a usable record and reports its state`() {
        // Environment-dependent on purpose: whatever cyvra.home points at (or whether it
        // is set at all), boot must never throw and must never expose a negative balance.
        val result = HostBootstrap.licenseResult

        assertTrue(result.record.scansRemaining >= 0, "balance must never go negative")
        assertTrue(result.record.deviceScanEntitlement >= 0, "entitlement must never go negative")
        assertEquals(result.record, HostBootstrap.licenseService.getLicense())
        assertTrue(
            HostBootstrap.describeLicenseState().startsWith("cyvra.license: "),
            "boot report must name the licence source",
        )
    }
}
