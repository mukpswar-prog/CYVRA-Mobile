package cyvra.mobile.host.protocol

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.host.license.FileBasedLicenseProvider
import cyvra.mobile.host.license.LicenseFileReason
import cyvra.mobile.host.license.LicenseFileResult
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class HostProtocolDispatcherTest {

    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = false
    }

    private fun request(command: HostCommand, requestId: String) = HostRequest(
        protocolVersion = HostProtocolV1.VERSION,
        requestId = requestId,
        command = command,
    )

    private fun licensedResult() = LicenseFileResult(
        record = CustomerLicenseRecord(
            licenseId = "LIC-000001",
            serialNumber = "CYVRA15092026SA3F1-1-25",
            customerEmail = "tech@example.com",
            planName = "25 Device Scans",
            deviceScanEntitlement = 25,
            scansUsed = 0,
            scansRemaining = 25,
            status = LicenseEntitlementStatus.ACTIVE,
        ),
        reason = LicenseFileReason.LOADED,
        sourcePath = "/installation/resources/license.json",
    )

    private fun deniedResult() = LicenseFileResult(
        record = CustomerLicenseRecord(
            licenseId = FileBasedLicenseProvider.UNLICENSED_LICENSE_ID,
            serialNumber = "",
            customerEmail = "",
            planName = FileBasedLicenseProvider.UNLICENSED_PLAN_NAME,
            deviceScanEntitlement = 0,
            scansUsed = 0,
            scansRemaining = 0,
            status = LicenseEntitlementStatus.UNKNOWN,
            lastVerifiedAt = "",
        ),
        reason = LicenseFileReason.FILE_MISSING,
        sourcePath = "/installation/resources/license.json",
    )

    private fun dispatcherFor(license: LicenseFileResult) = HostProtocolDispatcher(
        licenseResultProvider = { license },
    )

    private fun stringOf(payload: JsonObject, key: String): String? =
        (payload[key] as? JsonPrimitive)?.contentOrNull

    private fun boolOf(payload: JsonObject, key: String): Boolean? =
        (payload[key] as? JsonPrimitive)?.booleanOrNull

    private fun intOf(payload: JsonObject, key: String): Int? =
        (payload[key] as? JsonPrimitive)?.intOrNull

    @Test
    fun getHostInfo_returnsSuccessfulProtocolResponse() {
        val dispatcher = HostProtocolDispatcher()

        val request = HostRequest(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = "req-host-info-001",
            command = HostCommand.GET_HOST_INFO,
        )

        val response = dispatcher.dispatch(request)

        assertEquals(HostProtocolV1.VERSION, response.protocolVersion)
        assertEquals("req-host-info-001", response.requestId)
        assertEquals(HostResponseStatus.OK, response.status)
        assertEquals(
            HostProtocolV1.DEFAULT_HOST_VERSION,
            response.hostVersion
        )
        assertNull(response.error)

        val encoded = json.encodeToString(
            HostResponse.serializer(),
            response
        )

        val decoded = json.decodeFromString(
            HostResponse.serializer(),
            encoded
        )

        assertEquals(response, decoded)
    }

    // ------------------------------------------------------------------
    // GET_LICENSE_STATE
    // ------------------------------------------------------------------

    @Test
    fun getLicenseState_withoutAnInstalledLicenceFailsClosed() {
        val response = dispatcherFor(deniedResult())
            .dispatch(request(HostCommand.GET_LICENSE_STATE, "req-license-001"))

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")
        assertNull(response.error)

        val payload = response.payload
        assertEquals(false, boolOf(payload, "present"), "no licence file means not activated")
        assertEquals("FILE_MISSING", stringOf(payload, "reason"))
        assertEquals("UNKNOWN", stringOf(payload, "status"), "a denied record is UNKNOWN, never ACTIVE")
        assertEquals(0, intOf(payload, "scansRemaining"))
    }

    @Test
    fun getLicenseState_reportsTheInstalledEntitlement() {
        val response = dispatcherFor(licensedResult())
            .dispatch(request(HostCommand.GET_LICENSE_STATE, "req-license-002"))

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")

        val payload = response.payload
        assertEquals(true, boolOf(payload, "present"))
        assertEquals("LOADED", stringOf(payload, "reason"))
        assertEquals("ACTIVE", stringOf(payload, "status"))
        assertEquals(25, intOf(payload, "scansRemaining"))
    }

    @Test
    fun getLicenseState_leaksNoLicenceSecrets() {
        val response = dispatcherFor(licensedResult())
            .dispatch(request(HostCommand.GET_LICENSE_STATE, "req-license-003"))

        assertEquals(
            setOf("present", "reason", "status", "scansRemaining"),
            response.payload.keys,
            "GET_LICENSE_STATE must expose exactly the four documented keys",
        )

        val wire = json.encodeToString(HostResponse.serializer(), response)
        for (secret in listOf(
            "LIC-000001",
            "CYVRA15092026SA3F1-1-25",
            "tech@example.com",
            "25 Device Scans",
        )) {
            assertEquals(
                false,
                wire.contains(secret),
                "GET_LICENSE_STATE must not carry $secret across the wire",
            )
        }
    }

    @Test
    fun getLicenseState_needsNoScanSessionAndNeverMutatesState() {
        val dispatcher = dispatcherFor(deniedResult())

        val first = dispatcher.dispatch(request(HostCommand.GET_LICENSE_STATE, "req-license-004"))
        val second = dispatcher.dispatch(request(HostCommand.GET_LICENSE_STATE, "req-license-005"))

        assertEquals(HostResponseStatus.OK, first.status, first.error?.message ?: "")
        assertEquals(HostResponseStatus.OK, second.status, second.error?.message ?: "")

        // Read-only: a second read answers exactly what the first one did, and a
        // missing scan session is not a refusal reason for this command.
        assertEquals(first.payload, second.payload)
    }
}
