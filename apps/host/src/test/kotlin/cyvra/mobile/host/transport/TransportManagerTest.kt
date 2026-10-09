package cyvra.mobile.host.transport

import cyvra.mobile.host.engine.AuthorizationState
import cyvra.mobile.host.engine.Capability
import cyvra.mobile.host.engine.CapabilityMatrixLoader
import cyvra.mobile.host.engine.CapabilityResult
import cyvra.mobile.host.engine.Plane
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Selection semantics: dispatch classes are honoured **before** a plane is contacted, so
 * a restricted or untested domain can never be turned into an observation or a failure.
 */
class TransportManagerTest {

    private class StubTransport(
        override val plane: Plane,
        private val auth: AuthorizationState = AuthorizationState.SATISFIED,
        private val available: Boolean = true,
        private val outcome: ProbeOutcome = ProbeOutcome.SUCCESS,
    ) : Transport {
        var probed = 0

        override fun availability() =
            PlaneAvailability(available, if (available) "STUB_AVAILABLE" else "STUB_ABSENT")

        override fun authorization() = auth

        override fun probe(domain: String): ProbeResult {
            probed++
            return ProbeResult(
                domain = domain,
                plane = plane,
                outcome = outcome,
                result = if (outcome == ProbeOutcome.SUCCESS) {
                    CapabilityResult.PASS
                } else {
                    CapabilityResult.NOT_AVAILABLE
                },
                reasonCode = "STUB_${outcome}",
                capability = Capability.YES,
                evidenceReference = "STUB-$plane-$domain",
            )
        }
    }

    private val loader = CapabilityMatrixLoader()

    private fun manager(vararg transports: Transport) =
        TransportManager(loader, transports.toList())

    // ------------------------------------------- dispatch classes first

    @Test
    fun restrictedDomainIsNeverDispatched() {
        val adb = StubTransport(Plane.ADB)
        val result = manager(adb).probe("Cellular")

        assertEquals(0, adb.probed, "a restricted domain must not touch a transport")
        assertEquals(ProbeOutcome.RESTRICTED, result.outcome)
        assertEquals(CapabilityResult.RESTRICTED, result.result)
        assertEquals("RESTRICTED", result.statusToken)
    }

    @Test
    fun notTestedDomainIsRecordedAsNotTestedAndNeverAsFail() {
        val adb = StubTransport(Plane.ADB)
        val companion = StubTransport(Plane.COMPANION)
        val result = manager(adb, companion).probe("Touch")

        assertEquals(0, adb.probed)
        assertEquals(0, companion.probed)
        assertEquals(ProbeOutcome.NOT_COLLECTED, result.outcome)
        assertEquals(CapabilityResult.NOT_TESTED, result.result)
        assertFalse(result.outcome == ProbeOutcome.FAILURE, "NOT TESTED must not be softened into FAIL")
    }

    @Test
    fun physicalOnlyDomainIsReportedAsPhysical() {
        val result = manager(StubTransport(Plane.ADB)).probe("Mechanical")
        assertEquals(
            CapabilityResult.PHYSICAL_VERIFICATION_REQUIRED,
            result.result,
            "software-undeterminable is physical, not a failure",
        )
        assertEquals(ProbeOutcome.NOT_OBSERVABLE, result.outcome)
        assertEquals("PHYSICAL_VERIFICATION_REQUIRED", result.reasonCode)
    }

    @Test
    fun notAvailableDomainKeepsItsStatusToken() {
        val adb = StubTransport(Plane.ADB)
        val result = manager(adb).probe("Performance")

        assertEquals(CapabilityResult.NOT_AVAILABLE, result.result)
        assertEquals("NOT AVAILABLE", result.statusToken)
        assertEquals(0, adb.probed, "a not-available domain is not dispatched either")
    }

    // ------------------------------------------------- dispatch itself

    @Test
    fun evidenceBackedDomainDispatchesOnItsFirstAvailablePlane() {
        val usb = StubTransport(Plane.USB_PNP)
        val adb = StubTransport(Plane.ADB)

        val result = manager(usb, adb).probe("Connection")

        assertEquals(ProbeOutcome.SUCCESS, result.outcome)
        assertEquals(Plane.USB_PNP, result.plane, "P1 is always-on corroboration and comes first")
        assertEquals(1, usb.probed, "a healthy first plane must short-circuit")
        assertEquals(0, adb.probed)
        assertEquals(Capability.YES, result.capability)
    }

    @Test
    fun closedGateProducesARefusalRatherThanAnObservation() {
        val usb = StubTransport(Plane.USB_PNP, available = false)
        val adb = StubTransport(Plane.ADB, auth = AuthorizationState.DEBUGGING_OFF)

        val result = manager(usb, adb).probe("Identity")
        assertEquals(0, adb.probed, "a closed gate must not be probed")
        assertEquals(ProbeOutcome.NOT_OBSERVABLE, result.outcome)
        assertTrue(result.reasonCode.startsWith("GATE_CLOSED"), "got ${result.reasonCode}")
        assertEquals(CapabilityResult.NOT_AVAILABLE, result.result)
        assertFalse(result.isEvidence)
    }

    @Test
    fun gateClosedIsPreferredOverMereAbsenceInTheReport() {
        val adb = StubTransport(Plane.ADB, auth = AuthorizationState.DEBUGGING_UNAUTHORIZED)
        val result = manager(adb).probe("Identity")
        assertEquals("GATE_CLOSED_DEBUGGING_UNAUTHORIZED", result.reasonCode)
    }

    @Test
    fun degradedCaptureIsNeverPromotedToEvidence() {
        val adb = StubTransport(Plane.ADB, outcome = ProbeOutcome.NOT_OBSERVABLE)
        val result = manager(adb).probe("Identity")

        assertFalse(result.isEvidence)
        assertEquals(ProbeOutcome.NOT_OBSERVABLE, result.outcome)
        assertEquals(CapabilityResult.NOT_AVAILABLE, result.result, "a degraded read is not evidence")
    }

    @Test
    fun evidenceBackedDomainWithNoRegisteredTransportIsReportedAsUnobservable() {
        // Identity is evidence-backed and P3-only, so a host with no ADB transport has no
        // plane that could answer. The refusal is recorded — the domain is not silently
        // dropped and is certainly not PASS.
        val result = manager().probe("Identity")

        assertEquals(ProbeOutcome.NOT_OBSERVABLE, result.outcome)
        assertEquals("TRANSPORT_NOT_REGISTERED", result.reasonCode)
        assertEquals(CapabilityResult.NOT_AVAILABLE, result.result)
        assertFalse(result.isEvidence)
    }

    @Test
    fun untestedPlaneOnlyDomainStillRecordsNotTested() {
        // Camera is P4-only AND recorded NOT TESTED, so its absent transport never even
        // becomes the reason — dispatch class wins over plane wiring.
        val result = manager(StubTransport(Plane.ADB)).probe("Camera")

        assertEquals(ProbeOutcome.NOT_COLLECTED, result.outcome)
        assertEquals(CapabilityResult.NOT_TESTED, result.result)
        assertFalse(result.isEvidence)
    }

    @Test
    fun unavailablePlaneIsSkippedAndTheNextPlaneTried() {
        val usb = StubTransport(Plane.USB_PNP, available = false)
        val adb = StubTransport(Plane.ADB)

        val result = manager(usb, adb).probe("Storage")
        assertEquals(ProbeOutcome.SUCCESS, result.outcome)
        assertEquals(Plane.ADB, result.plane)
        assertEquals(0, usb.probed)
        assertEquals(1, adb.probed)
    }

    // --------------------------------------------------------- matrix failures

    @Test
    fun unusableMatrixRefusesDispatchEntirely() {
        val broken = CapabilityMatrixLoader(File("no-such-matrix.md"))
        val adb = StubTransport(Plane.ADB)
        val result = TransportManager(broken, listOf(adb)).probe("Connection")

        assertEquals(0, adb.probed, "an unusable matrix must stop dispatch, not fall back to YES")
        assertEquals("MATRIX_UNUSABLE", result.reasonCode)
        assertEquals(ProbeOutcome.FAILURE, result.outcome)
    }

    @Test
    fun unknownDomainSurfacesAsUnknownRatherThanPassing() {
        val result = manager(StubTransport(Plane.ADB)).probe("NotADomain")
        assertEquals("DOMAIN_UNKNOWN", result.reasonCode)
        assertEquals(CapabilityResult.UNKNOWN, result.result)
        assertFalse(result.isEvidence)
    }
}
