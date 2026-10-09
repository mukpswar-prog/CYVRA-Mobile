package cyvra.mobile.host.transport

import cyvra.mobile.host.engine.AuthorizationState
import cyvra.mobile.host.engine.Capability
import cyvra.mobile.host.engine.CapabilityMatrixLoader
import cyvra.mobile.host.engine.CapabilityResult
import cyvra.mobile.host.engine.DomainStatus
import cyvra.mobile.host.engine.MatrixLoadResult
import cyvra.mobile.host.engine.Plane
import cyvra.mobile.host.engine.RestrictedStatus
import kotlinx.serialization.Serializable

/** Observed availability of a plane. Never assumed; always carries a reason. */
data class PlaneAvailability(
    val isAvailable: Boolean,
    val reasonCode: String,
)

/**
 * Outcome vocabulary, mirrored from `CYVRA_FLEET_TELEMETRY_SPEC.md` §4.5 so a probe
 * result maps 1:1 onto a capability challenge event without a translation table.
 *
 * The `outcome` vocabulary deliberately mirrors the evidence vocabulary: an observation
 * that could not be made is `NOT_OBSERVABLE`, never `SUCCESS`.
 */
@Serializable
enum class ProbeOutcome {
    SUCCESS,
    FAILURE,
    NOT_APPLICABLE,
    NOT_OBSERVABLE,
    RESTRICTED,
    NOT_COLLECTED,
}

/**
 * The result of probing one domain on one plane.
 *
 * `statusToken` carries a Spec §24 token when a value was withheld, so the record still
 * says **why** rather than silently losing the fact. It is never a fabricated value and
 * never a blank.
 */
@Serializable
data class ProbeResult(
    val domain: String,
    val plane: Plane,
    val outcome: ProbeOutcome,
    /** Spec §23 result for this domain. Distinct from [outcome]. */
    val result: CapabilityResult,
    /** Engine reason code. Never free text. */
    val reasonCode: String,
    val capability: Capability = Capability.NO,
    /** Spec §24 status token, present only when a value was withheld. */
    val statusToken: String? = null,
    val evidenceReference: String? = null,
    val degradedServices: List<String> = emptyList(),
    val truncatedBytes: Long? = null,
    val durationMs: Long = 0,
) {
    /** True only for a healthy, dispatchable observation. */
    val isEvidence: Boolean get() = outcome == ProbeOutcome.SUCCESS && degradedServices.isEmpty()
}

/** One USB/PnP device record. P1 observes descriptors only — nothing internal. */
data class UsbDeviceRecord(
    val vendorId: String,
    val productId: String,
    val usbSerialString: String? = null,
    val manufacturer: String? = null,
    val product: String? = null,
)

/** One MTP volume. P2 sees shared-storage metadata only — no identifiers, no props. */
data class MtpVolume(
    val name: String,
    val fileCount: Int,
)

/** A reading delivered by the optional companion APK. */
data class CompanionReading(
    val domain: String,
    val value: String,
)

/**
 * A single access plane (governed §2).
 *
 * Implementations return **typed refusals**, never silent gaps: every method that cannot
 * answer says so with a reason code, so no caller can mistake a refusal for an
 * observation.
 */
interface Transport {
    val plane: Plane

    /** Observed availability, not an assumption. */
    fun availability(): PlaneAvailability

    /** The plane's consent gate as observed on the device right now. */
    fun authorization(): AuthorizationState

    /**
     * Dispatches the domain's allowlisted read-only observation.
     *
     * Implementations MUST NOT issue a command outside their compiled allowlist, and MUST
     * NOT install, input, screencap, reboot or purge.
     */
    fun probe(domain: String): ProbeResult
}

/**
 * P1 — USB/PnP. Consent gate: **none**.
 *
 * The cheapest and most durable signal, and the only one that still answers "is anything
 * plugged in?" when ADB is off — which is how "cable unplugged" is distinguished from
 * "debugging disabled".
 *
 * Observes VID/PID, USB serial string, manufacturer/product and connect state.
 * **Nothing internal** (governed §2).
 */
class UsbPnpTransport(
    private val enumerate: UsbPnpProbe,
    private val present: () -> Boolean = { true },
) : Transport {
    override val plane: Plane = Plane.USB_PNP

    override fun availability(): PlaneAvailability =
        if (present()) PlaneAvailability(true, "USB_ENUMERATION_OK")
        else PlaneAvailability(false, "USB_NOT_PRESENT")

    override fun authorization(): AuthorizationState = AuthorizationState.NOT_REQUIRED

    override fun probe(domain: String): ProbeResult {
        if (domain !in P1_DOMAINS) {
            return refusal(domain, ProbeOutcome.NOT_APPLICABLE, CapabilityResult.NOT_APPLICABLE, "DOMAIN_NOT_ON_PLANE")
        }
        val devices = try {
            enumerate.enumerate()
        } catch (e: Exception) {
            return refusal(domain, ProbeOutcome.NOT_OBSERVABLE, CapabilityResult.NOT_AVAILABLE, "PNP_ENUMERATION_FAILED")
        }
        if (devices.isEmpty()) {
            return refusal(domain, ProbeOutcome.NOT_OBSERVABLE, CapabilityResult.NOT_AVAILABLE, "USB_NOT_PRESENT")
        }
        // Descriptors only. No internal property is read on this plane.
        return ProbeResult(
            domain = domain,
            plane = plane,
            outcome = ProbeOutcome.SUCCESS,
            result = CapabilityResult.PASS,
            reasonCode = "USB_DESCRIPTOR_OBSERVED",
            capability = Capability.YES,
            evidenceReference = "P1-USB-DESCRIPTOR",
        )
    }

    private fun refusal(domain: String, outcome: ProbeOutcome, result: CapabilityResult, code: String) =
        ProbeResult(domain = domain, plane = plane, outcome = outcome, result = result, reasonCode = code)

    fun interface UsbPnpProbe {
        fun enumerate(): List<UsbDeviceRecord>
    }

    companion object {
        val P1_DOMAINS = setOf("Connection")
    }
}

/**
 * P2 — WPD/MTP. Consent gate: **unlocked**.
 *
 * **Locked = empty, by definition of the plane.** An empty result on a locked device is
 * this plane's expected behaviour — not a failure, and not evidence that storage is
 * empty (governed §2).
 *
 * Shared-storage volumes and file metadata only: **no identifiers, no properties**.
 */
class MtpTransport(
    private val listVolumes: MtpProbe,
    private val lockState: () -> AuthorizationState = { AuthorizationState.LOCKED },
) : Transport {
    override val plane: Plane = Plane.WPD_MTP

    override fun availability(): PlaneAvailability {
        val state = authorization()
        return if (state.isOpen) {
            PlaneAvailability(true, "MTP_EXPOSED")
        } else {
            PlaneAvailability(false, "MTP_LOCKED_OR_HIDDEN")
        }
    }

    override fun authorization(): AuthorizationState = lockState()

    override fun probe(domain: String): ProbeResult {
        if (domain !in P2_DOMAINS) {
            return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.NOT_APPLICABLE, result = CapabilityResult.NOT_APPLICABLE,
                reasonCode = "DOMAIN_NOT_ON_PLANE",
            )
        }
        if (!authorization().isOpen) {
            // Expected behaviour of a locked device — recorded, never escalated to FAIL.
            return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.NOT_OBSERVABLE, result = CapabilityResult.NOT_TESTED,
                reasonCode = "MTP_EMPTY_WHILE_LOCKED",
                statusToken = RestrictedStatus.NOT_EXPOSED.token,
            )
        }
        val volumes = try {
            listVolumes.list()
        } catch (e: Exception) {
            return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.NOT_OBSERVABLE, result = CapabilityResult.NOT_AVAILABLE,
                reasonCode = "MTP_ENUMERATION_FAILED",
            )
        }
        return ProbeResult(
            domain = domain, plane = plane,
            outcome = ProbeOutcome.SUCCESS, result = CapabilityResult.PASS,
            reasonCode = "MTP_VOLUME_METADATA_OBSERVED:${volumes.size}",
            capability = Capability.YES,
            evidenceReference = "P2-MTP-VOLUME",
        )
    }

    /** Injected so lock state is observable without a real device. */
    fun interface MtpProbe {
        fun list(): List<MtpVolume>
    }

    companion object {
        val P2_DOMAINS = setOf("Storage")
    }
}

/** P3 — ADB. Consent gate: **debugging + key accept**. The workhorse. */
class AdbTransport(
    private val adbClient: AdbClient,
    private val serialProvider: () -> String?,
) : Transport {
    override val plane: Plane = Plane.ADB

    override fun availability(): PlaneAvailability {
        val serial = serialProvider() ?: return PlaneAvailability(false, "NO_TARGET_SERIAL")
        val state = deviceState(serial)
        return when (state) {
            "device" -> PlaneAvailability(true, "ADB_DEVICE")
            "unauthorized" -> PlaneAvailability(false, "ADB_UNAUTHORIZED")
            "offline" -> PlaneAvailability(false, "ADB_OFFLINE")
            else -> PlaneAvailability(false, "ADB_TARGET_ABSENT")
        }
    }

    override fun authorization(): AuthorizationState {
        val serial = serialProvider() ?: return AuthorizationState.UNKNOWN
        return when (deviceState(serial)) {
            "device" -> AuthorizationState.SATISFIED
            "unauthorized" -> AuthorizationState.DEBUGGING_UNAUTHORIZED
            "offline" -> AuthorizationState.DEBUGGING_OFFLINE
            else -> AuthorizationState.DEBUGGING_OFF
        }
    }

    override fun probe(domain: String): ProbeResult {
        if (domain in CONNECTION_DOMAIN) {
            return probeConnection(domain)
        }
        val command = READ_ONLY_ALLOWLIST[domain]
            ?: return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.NOT_APPLICABLE, result = CapabilityResult.NOT_APPLICABLE,
                reasonCode = "DOMAIN_NOT_ON_PLANE",
            )
        // Closed allowlist: anything not listed above is refused before it is built.
        if (command in PROHIBITED_COMMANDS) {
            return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.RESTRICTED, result = CapabilityResult.RESTRICTED,
                reasonCode = "RESTRICTED_BY_POLICY",
                statusToken = RestrictedStatus.RESTRICTED.token,
            )
        }

        val serial = serialProvider() ?: return ProbeResult(
            domain = domain, plane = plane,
            outcome = ProbeOutcome.NOT_OBSERVABLE, result = CapabilityResult.NOT_AVAILABLE,
            reasonCode = "NO_TARGET_SERIAL",
        )
        if (!authorization().isOpen) {
            return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.NOT_OBSERVABLE, result = CapabilityResult.NOT_AVAILABLE,
                reasonCode = "GATE_CLOSED_${authorization().name}",
                statusToken = RestrictedStatus.NOT_EXPOSED.token,
            )
        }

        val started = System.nanoTime()
        val execution = adbClient.runShell(serial, command, COMMAND_TIMEOUT_MS)
        val elapsed = (System.nanoTime() - started) / 1_000_000

        val output = execution.stdout.orEmpty() + execution.stderr.orEmpty()
        val degraded = HEALTH_MARKERS.filter { output.contains(it, ignoreCase = true) }

        if (degraded.isNotEmpty()) {
            // adb still reports state=device while the guest framework is dying, so a
            // degraded capture is NOT evidence. It is never promoted over a good one.
            return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.NOT_OBSERVABLE, result = CapabilityResult.NOT_AVAILABLE,
                reasonCode = "HEALTH_DEGRADED",
                degradedServices = degraded,
                durationMs = elapsed,
            )
        }
        if (output.length > DEFAULT_MAX_OUTPUT_BYTES) {
            return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.SUCCESS, result = CapabilityResult.PASS,
                reasonCode = "OUTPUT_TRUNCATED",
                capability = Capability.PARTIAL,
                truncatedBytes = output.length.toLong(),
                evidenceReference = "P3-$domain",
                durationMs = elapsed,
            )
        }
        if (!execution.isSuccess && output.isBlank()) {
            return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.NOT_OBSERVABLE, result = CapabilityResult.NOT_AVAILABLE,
                reasonCode = "ADB_COMMAND_FAILED",
                durationMs = elapsed,
            )
        }
        return ProbeResult(
            domain = domain, plane = plane,
            outcome = ProbeOutcome.SUCCESS, result = CapabilityResult.PASS,
            reasonCode = "ADB_OBSERVATION_OK",
            capability = Capability.YES,
            evidenceReference = "P3-$domain",
            durationMs = elapsed,
        )
    }

    private fun probeConnection(domain: String): ProbeResult {
        val serial = serialProvider() ?: return ProbeResult(
            domain = domain, plane = plane,
            outcome = ProbeOutcome.NOT_OBSERVABLE, result = CapabilityResult.NOT_AVAILABLE,
            reasonCode = "ADB_TARGET_ABSENT",
        )
        val known = adbClient.listDevices().any { it.serial == serial }
        return if (known) {
            ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.SUCCESS, result = CapabilityResult.PASS,
                reasonCode = "ADB_TARGET_LISTED",
                capability = Capability.YES,
                evidenceReference = "P3-CONNECTION",
            )
        } else {
            ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.NOT_OBSERVABLE, result = CapabilityResult.NOT_AVAILABLE,
                reasonCode = "ADB_TARGET_NOT_FOUND",
            )
        }
    }

    private fun deviceState(serial: String): String =
        adbClient.listDevices().firstOrNull { it.serial == serial }?.state ?: "absent"

    companion object {
        private val CONNECTION_DOMAIN = setOf("Connection")
        private const val COMMAND_TIMEOUT_MS = 10_000L
        const val DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024

        /** A post-capture health scan: a dying guest still reports state=device. */
        private val HEALTH_MARKERS = listOf(
            "DEAD_OBJECT", "DUMP TIMEOUT", "Can't find service",
            "Failure calling service", "Broken pipe",
        )

        /** Closed read-only allowlist. No install, input, screencap, reboot or purge. */
        val READ_ONLY_ALLOWLIST: Map<String, String> = mapOf(
            "Identity" to "getprop",
            "Security" to "getprop",
            "Hardware" to "getprop",
            "System" to "getprop",
            "Battery" to "dumpsys battery",
            "Display" to "dumpsys display",
            "Sensors" to "dumpsys sensorservice",
            "Wi-Fi" to "dumpsys wifi",
            "Storage" to "df",
            "Applications" to "pm list packages",
            "Performance" to "dumpsys diskstats",
        )

        private val PROHIBITED_COMMANDS = setOf(
            "wipe", "recovery", "reboot", "input", "screencap", "pm clear", "rm",
        )
    }
}

/**
 * P4 — Companion APK. Consent gate: **install + runtime grants**. Optional by
 * construction.
 *
 * The engine must be fully correct when this plane is absent: domains reachable only
 * through P4 record *not tested*, never FAIL (Spec §82). IMEI remains restricted on
 * A10+ even with every runtime permission granted — a permission grant does not lift an
 * identifier policy rule. **No root path exists.**
 */
class CompanionApkTransport(
    private val isInstalled: () -> Boolean,
    private val read: CompanionProbe,
    private val grantedScopes: () -> Set<String> = { emptySet() },
) : Transport {
    override val plane: Plane = Plane.COMPANION

    override fun availability(): PlaneAvailability =
        if (isInstalled()) PlaneAvailability(true, "COMPANION_INSTALLED")
        else PlaneAvailability(false, "COMPANION_ABSENT")

    override fun authorization(): AuthorizationState =
        if (!isInstalled()) AuthorizationState.INSTALL_ABSENT else AuthorizationState.SATISFIED

    override fun probe(domain: String): ProbeResult {
        if (domain !in P4_DOMAINS) {
            return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.NOT_APPLICABLE, result = CapabilityResult.NOT_APPLICABLE,
                reasonCode = "DOMAIN_NOT_ON_PLANE",
            )
        }
        if (!isInstalled()) {
            // Optional plane: its absence is a fact, not a failure of the domain.
            return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.NOT_COLLECTED, result = CapabilityResult.NOT_TESTED,
                reasonCode = "COMPANION_ABSENT",
                statusToken = RestrictedStatus.NOT_COLLECTED.token,
            )
        }
        if (domain !in grantedScopes()) {
            return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.NOT_OBSERVABLE, result = CapabilityResult.ASSISTED,
                reasonCode = "PERMISSION_DENIED",
                statusToken = RestrictedStatus.CONDITIONAL.token,
            )
        }
        val reading = try {
            read.read(domain)
        } catch (e: Exception) {
            return ProbeResult(
                domain = domain, plane = plane,
                outcome = ProbeOutcome.NOT_OBSERVABLE, result = CapabilityResult.NOT_AVAILABLE,
                reasonCode = "COMPANION_READ_FAILED",
            )
        } ?: return ProbeResult(
            domain = domain, plane = plane,
            outcome = ProbeOutcome.NOT_OBSERVABLE, result = CapabilityResult.NOT_AVAILABLE,
            reasonCode = "COMPANION_NO_READING",
        )

        return ProbeResult(
            domain = domain, plane = plane,
            outcome = ProbeOutcome.SUCCESS, result = CapabilityResult.PASS,
            reasonCode = "COMPANION_READING_OK",
            capability = Capability.YES,
            evidenceReference = "P4-${reading.domain}",
        )
    }

    fun interface CompanionProbe {
        fun read(domain: String): CompanionReading?
    }

    companion object {
        val P4_DOMAINS = setOf(
            "Camera", "Audio", "Sensors", "Haptics", "GNSS", "Touch", "Biometrics", "Wi-Fi", "Bluetooth",
        )
    }
}

/**
 * Selects a transport for a domain and composes the refusal when none can answer.
 *
 * Adheres to `CORE_ENGINE_TRANSPORT_ABSTRACTION.md` §5 (selection) and
 * `CORE_ENGINE_CAPABILITY_MATRIX_RUNTIME.md` §4 (dispatch classes).
 *
 * **Dispatch classes are honoured before any plane is touched:**
 * - `RESTRICTED` → never attempted, never retried; recorded with its §24 token.
 * - `NOT_TESTED` → not dispatched; recorded as *not tested*, never FAIL.
 * - `EVIDENCE_BACKED` → dispatched across the domain's planes in precedence order.
 *
 * Selection is per **domain**, not per device: one domain may be answered over P1+P3
 * while another stays unobserved because P4 is absent.
 */
class TransportManager(
    private val loader: CapabilityMatrixLoader,
    private val transports: List<Transport>,
    private val availability: (Plane) -> PlaneAvailability = { plane ->
        transports.firstOrNull { it.plane == plane }?.availability()
            ?: PlaneAvailability(false, "TRANSPORT_NOT_REGISTERED")
    },
    private val authorization: (Plane) -> AuthorizationState = { plane ->
        transports.firstOrNull { it.plane == plane }?.authorization() ?: AuthorizationState.UNKNOWN
    },
) {
    /** Planes in governed precedence: always-on corroboration first, workhorse next. */
    private val precedence = listOf(Plane.USB_PNP, Plane.ADB, Plane.WPD_MTP, Plane.COMPANION)

    fun transportFor(plane: Plane): Transport? = transports.firstOrNull { it.plane == plane }

    /**
     * Probes [domain], applying the matrix before touching any transport.
     *
     * Never throws. Never returns SUCCESS for something that was not observed.
     */
    fun probe(domain: String): ProbeResult {
        val result = loader.load()
        val matrix = (result as? MatrixLoadResult.Loaded)?.matrix
        val row = matrix?.row(domain)
            ?: return ProbeResult(
                domain = domain, plane = Plane.ADB,
                outcome = ProbeOutcome.FAILURE, result = CapabilityResult.UNKNOWN,
                reasonCode = if (result is MatrixLoadResult.Unusable) "MATRIX_UNUSABLE" else "DOMAIN_UNKNOWN",
            )

        // Dispatch classes decided from the matrix, before any plane is contacted.
        when (row.status) {
            DomainStatus.RESTRICTED -> return ProbeResult(
                domain = domain, plane = Plane.ADB,
                outcome = ProbeOutcome.RESTRICTED, result = CapabilityResult.RESTRICTED,
                reasonCode = "RESTRICTED_BY_POLICY",
                statusToken = RestrictedStatus.RESTRICTED.token,
                evidenceReference = row.evidenceReference,
            )
            DomainStatus.NOT_TESTED -> return ProbeResult(
                domain = domain, plane = Plane.ADB,
                outcome = ProbeOutcome.NOT_COLLECTED, result = CapabilityResult.NOT_TESTED,
                reasonCode = "DOMAIN_NOT_TESTED",
                statusToken = RestrictedStatus.NOT_COLLECTED.token,
                evidenceReference = row.evidenceReference,
            )
            DomainStatus.NOT_AVAILABLE -> return ProbeResult(
                domain = domain, plane = Plane.ADB,
                outcome = ProbeOutcome.NOT_OBSERVABLE, result = CapabilityResult.NOT_AVAILABLE,
                reasonCode = "DOMAIN_NOT_AVAILABLE",
                statusToken = RestrictedStatus.NOT_AVAILABLE.token,
                evidenceReference = row.evidenceReference,
            )
            DomainStatus.PHYSICAL_VERIFICATION_REQUIRED -> return ProbeResult(
                domain = domain, plane = Plane.ADB,
                outcome = ProbeOutcome.NOT_OBSERVABLE,
                result = CapabilityResult.PHYSICAL_VERIFICATION_REQUIRED,
                reasonCode = "PHYSICAL_VERIFICATION_REQUIRED",
                evidenceReference = row.evidenceReference,
            )
            DomainStatus.NOT_APPLICABLE -> return ProbeResult(
                domain = domain, plane = Plane.ADB,
                outcome = ProbeOutcome.NOT_APPLICABLE, result = CapabilityResult.NOT_APPLICABLE,
                reasonCode = "OEM_SCOPE_NOT_APPLICABLE",
                evidenceReference = row.evidenceReference,
            )
            DomainStatus.ERROR -> return ProbeResult(
                domain = domain, plane = Plane.ADB,
                outcome = ProbeOutcome.FAILURE, result = row.result,
                reasonCode = "MATRIX_ROW_ERROR",
                evidenceReference = row.evidenceReference,
            )
            DomainStatus.EVIDENCE_BACKED -> Unit // dispatch below
        }

        val attempts = mutableListOf<ProbeResult>()
        for (plane in precedence) {
            if (plane !in row.planes) continue
            val transport = transportFor(plane) ?: run {
                attempts += refused(domain, plane, ProbeOutcome.NOT_OBSERVABLE, "TRANSPORT_NOT_REGISTERED")
                continue
            }
            val avail = availability(plane)
            if (!avail.isAvailable) {
                attempts += refused(domain, plane, ProbeOutcome.NOT_OBSERVABLE, avail.reasonCode)
                continue
            }
            val auth = authorization(plane)
            if (!auth.isOpen) {
                attempts += refused(domain, plane, ProbeOutcome.NOT_OBSERVABLE, "GATE_CLOSED_${auth.name}")
                continue
            }
            // Most-restrictive-wins: a closed gate or an off-plane domain yields NO.
            val capability = loader.canProbe(domain, plane, auth)
            if (capability == Capability.NO) {
                attempts += refused(domain, plane, ProbeOutcome.NOT_APPLICABLE, "CAPABILITY_NO")
                continue
            }

            val observed = try {
                transport.probe(domain)
            } catch (e: Exception) {
                refused(domain, plane, ProbeOutcome.NOT_OBSERVABLE, "TRANSPORT_THREW")
                continue
            }
            if (observed.isEvidence) {
                return observed.copy(capability = capability)
            }
            attempts += observed
        }

        // No plane answered: report the most informative attempt, never a synthetic PASS.
        // Outcome ranks first; a closed gate outranks a mere absence at equal rank,
        // because "enable debugging" is actionable and "not registered" is not.
        return attempts.maxWithOrNull(
            compareBy(
                { OUTCOME_RANK.getOrElse(it.outcome) { 0 } },
                { if (it.reasonCode.startsWith("GATE_CLOSED")) 1 else 0 },
            ),
        ) ?: refused(domain, Plane.USB_PNP, ProbeOutcome.NOT_APPLICABLE, "DOMAIN_HAS_NO_PLANE")
    }

    private fun refused(domain: String, plane: Plane, outcome: ProbeOutcome, code: String) =
        ProbeResult(
            domain = domain, plane = plane,
            outcome = outcome, result = CapabilityResult.NOT_AVAILABLE,
            reasonCode = code,
        )

    private companion object {
        val OUTCOME_RANK = mapOf(
            ProbeOutcome.RESTRICTED to 5,
            ProbeOutcome.NOT_OBSERVABLE to 4,
            ProbeOutcome.FAILURE to 3,
            ProbeOutcome.NOT_COLLECTED to 2,
            ProbeOutcome.NOT_APPLICABLE to 1,
        )
    }
}
