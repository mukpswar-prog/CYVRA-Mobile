package cyvra.mobile.host.engine

import kotlinx.serialization.Serializable
import java.io.File

/**
 * Spec §22 capability states.
 *
 * These five values are never flattened into a PASS/FAIL pair: capability answers
 * *could this ever be observed*, while [CapabilityResult] answers *what did this run
 * show*. The two axes are independent, so a domain can be [YES] capable and still
 * [CapabilityResult.NOT_TESTED] in a given run.
 */
@Serializable
enum class Capability {
    YES,
    PARTIAL,
    CONDITIONAL,
    ASSISTED,
    NO,
}

/**
 * Governed `CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2` §2 access planes.
 *
 * `matrixLabel` is the P1–P4 spelling used by the capability matrix's
 * `Plane / source` column; `wireName` is the enum spelling used by the `plane`
 * field of `docs/CYVRA_CAPABILITY_PATCH_SCHEMA.md`, so a patch's
 * `procedure_overrides[]` resolve without a translation table.
 */
@Serializable
enum class Plane(val matrixLabel: String, val wireName: String) {
    USB_PNP("P1", "USB_PNP"),
    WPD_MTP("P2", "WPD_MTP"),
    ADB("P3", "ADB"),
    COMPANION("P4", "COMPANION"),
    ;

    companion object {
        fun fromMatrixLabel(label: String): Plane? = values().firstOrNull {
            it.matrixLabel.equals(label.trim(), ignoreCase = true)
        }

        fun fromWireName(name: String): Plane? = values().firstOrNull { it.wireName == name }
    }
}

/**
 * Observed authorisation state of a plane's consent gate (governed §2).
 *
 * Authorisation is **observed, never assumed**, and a capability patch can never grant
 * it ([PatchVerifier] rejects any attempt). [UNKNOWN] behaves as *closed*: a state the
 * engine could not read must not open a gate.
 */
@Serializable
enum class AuthorizationState {
    /** The state could not be read. Behaves as closed. */
    UNKNOWN,

    /** The plane requires no consent at all (P1 USB/PnP). */
    NOT_REQUIRED,

    /** The plane's consent gate was observed open. */
    SATISFIED,

    /** P2 gate closed: the device screen is locked, so MTP is empty by definition. */
    LOCKED,

    /** P3 gate closed: USB debugging is off. */
    DEBUGGING_OFF,

    /** P3 gate closed: debugging is on but the host key has not been accepted. */
    DEBUGGING_UNAUTHORIZED,

    /** P3 gate closed: the target dropped off the bus (transient). */
    DEBUGGING_OFFLINE,

    /** P4 gate closed: the companion APK is not installed. */
    INSTALL_ABSENT,

    /** P4 gate closed: a runtime permission was denied. */
    PERMISSION_DENIED,

    /** The transport is re-enumerating. Closed until a re-sample settles. */
    TRANSITIONING,
    ;

    /** True only when this plane's consent gate is known to be open. */
    val isOpen: Boolean
        get() = this == NOT_REQUIRED || this == SATISFIED
}

/**
 * Spec §23 result vocabulary. A missing permission, unavailable OEM source or restricted
 * identifier must never automatically become [FAIL].
 */
@Serializable
enum class CapabilityResult(val token: String) {
    PASS("PASS"),
    FAIL("FAIL"),
    NOT_TESTED("NOT TESTED"),
    NOT_AVAILABLE("NOT AVAILABLE"),
    NOT_APPLICABLE("NOT APPLICABLE"),
    CONDITIONAL("CONDITIONAL"),
    ASSISTED("ASSISTED"),
    PHYSICAL_VERIFICATION_REQUIRED("PHYSICAL VERIFICATION REQUIRED"),
    RESTRICTED("RESTRICTED"),
    UNKNOWN("UNKNOWN"),
    ERROR("ERROR"),
    ;

    companion object {
        private val TOKENS = values().map { it.token }

        /**
         * Returns the **leading** status token found in [text], i.e. the earliest match in
         * reading order (longest first on a tie).
         *
         * Reading order, not longest-match, is what makes `PASS · CID NOT AVAILABLE` resolve
         * to [PASS] while the trailing `NOT AVAILABLE` stays visible as a qualifier. A
         * longest-match scan would mis-read that row as [NOT_AVAILABLE].
         */
        fun fromText(text: String): CapabilityResult? {
            val plain = CapabilityMatrixLoader.flatten(text)
            val token = CapabilityMatrixLoader.leadingToken(plain, TOKENS) ?: return null
            return values().firstOrNull { it.token == token }
        }
    }
}

/**
 * The four statuses TASK S requires of the loader, plus the two Spec §23 outcomes that
 * would otherwise be silently coerced.
 *
 * Derived from [CapabilityResult] so a domain's dispatch class can never disagree with its
 * recorded result.
 */
@Serializable
enum class DomainStatus {
    /** The matrix carries a fixture reference for this domain on an available plane. */
    EVIDENCE_BACKED,

    /** Capable somewhere, but not dispatched this run — never reported as FAIL. */
    NOT_TESTED,

    /** Expressly blocked by a governed rule. Do not attempt, do not retry. */
    RESTRICTED,

    /** Sought, and the source was absent or denied. */
    NOT_AVAILABLE,

    /** Software cannot determine it; a human must look at the device. */
    PHYSICAL_VERIFICATION_REQUIRED,

    /** The row's scope does not match the live device. Retained, exerts no effect. */
    NOT_APPLICABLE,

    /** A FAIL/ERROR/UNKNOWN result. Distinct from NOT_TESTED so nothing is softened. */
    ERROR,
    ;

    companion object {
        fun of(result: CapabilityResult): DomainStatus = when (result) {
            CapabilityResult.PASS,
            CapabilityResult.CONDITIONAL,
            CapabilityResult.ASSISTED,
            -> EVIDENCE_BACKED

            CapabilityResult.NOT_TESTED -> NOT_TESTED
            CapabilityResult.RESTRICTED -> RESTRICTED
            CapabilityResult.NOT_AVAILABLE -> NOT_AVAILABLE
            CapabilityResult.PHYSICAL_VERIFICATION_REQUIRED -> PHYSICAL_VERIFICATION_REQUIRED
            CapabilityResult.NOT_APPLICABLE -> NOT_APPLICABLE
            CapabilityResult.FAIL,
            CapabilityResult.ERROR,
            CapabilityResult.UNKNOWN,
            -> ERROR
        }
    }
}

/**
 * Spec §24 identifier status tokens.
 *
 * Never fabricate. When a value is unavailable the engine writes the token **for that
 * field**, so the fact that it was sought and withheld remains visible. A token is never
 * replaced by a blank: an absent field and an uncollected field are different facts.
 */
@Serializable
enum class RestrictedStatus(val token: String) {
    NOT_EXPOSED("NOT EXPOSED"),
    RESTRICTED("RESTRICTED"),
    NOT_AVAILABLE("NOT AVAILABLE"),
    NOT_COLLECTED("NOT COLLECTED"),
    CONDITIONAL("CONDITIONAL"),
    ;

    companion object {
        private val TOKENS = values().map { it.token }

        fun fromText(text: String): RestrictedStatus? {
            val token = CapabilityMatrixLoader.leadingToken(
                CapabilityMatrixLoader.flatten(text),
                TOKENS,
            ) ?: return null
            return values().firstOrNull { it.token == token }
        }
    }
}

/** One parsed row of the capability matrix's Section 4 table (Spec §84 column set). */
@Serializable
data class MatrixDomainRow(
    val ordinal: Int,
    val domain: String,
    val itemId: String,
    /** True when the item id is a `[P]` provisional seed rather than a ratified `[S]` id. */
    val provisional: Boolean,
    val capability: Capability,
    val planes: Set<Plane>,
    val evidenceType: String,
    val result: CapabilityResult,
    val status: DomainStatus,
    val evidenceReference: String,
)

/** A validated capability matrix: 22 domains, indexed for lookup. */
class CapabilityMatrix(
    val rows: List<MatrixDomainRow>,
    val sourcePath: String,
    val documentStatus: String,
) {
    private val byDomain: Map<String, MatrixDomainRow> =
        rows.associateBy { normalizeDomain(it.domain) }

    val size: Int get() = rows.size

    fun row(domain: String): MatrixDomainRow? = byDomain[normalizeDomain(domain)]

    companion object {
        fun normalizeDomain(domain: String): String = domain.trim().lowercase()
    }
}

/** Result of loading the matrix. Load is fail-closed: anything invalid is [Unusable]. */
sealed interface MatrixLoadResult {
    data class Loaded(val matrix: CapabilityMatrix) : MatrixLoadResult

    /**
     * The matrix must not be used. The engine enters MATRIX-UNUSABLE mode: no
     * matrix-dependent probe is dispatched and every domain resolves to
     * [CapabilityResult.NOT_AVAILABLE]. It never falls back to assuming everything is YES.
     */
    data class Unusable(
        val reason: String,
        val violations: List<String> = emptyList(),
    ) : MatrixLoadResult
}

/**
 * Loads `docs/CYVRA_CAPABILITY_MATRIX_V1.md` at startup and resolves capability for a
 * domain on a plane.
 *
 * Adheres to:
 * - `CORE_ENGINE_CAPABILITY_MATRIX_RUNTIME.md` §2 (load, validate, refuse) and §3.5
 *   (most-restrictive-wins composition)
 * - Spec §21 (the 22 master diagnostic domains), §22 (capability states),
 *   §23 (result vocabulary), §82 (no false automation), §84 (matrix row shape)
 *
 * This resolver is deliberately *pure*: it knows nothing about live transport
 * availability. Live plane availability is composed by `TransportManager` (PART 4), which
 * asks this class first and then applies its own availability check — matching §3.5 of
 * the runtime design, where `plane UNAVAILABLE` and `authorization closed` are separate
 * reasons with separate report text.
 *
 * @param matrixFile the matrix document; defaults to a search from the working directory
 *   upward for `docs/CYVRA_CAPABILITY_MATRIX_V1.md`, so it resolves whether the process
 *   starts at the repo root, `apps/host` or `apps/android`.
 */
class CapabilityMatrixLoader(
    private val matrixFile: File = resolveDefaultMatrixFile(),
) {
    private var cached: MatrixLoadResult? = null

    /** False once the matrix has failed validation. */
    val isUsable: Boolean
        get() = load() is MatrixLoadResult.Loaded

    /** Loads on first use and caches the outcome, so startup reads the file once. */
    fun load(): MatrixLoadResult {
        cached?.let { return it }
        val result = when {
            !matrixFile.isFile ->
                MatrixLoadResult.Unusable("matrix file not found: ${matrixFile.absolutePath}")

            else -> try {
                parse(matrixFile.readText(Charsets.UTF_8), matrixFile.path)
            } catch (e: Exception) {
                MatrixLoadResult.Unusable(
                    "matrix parse failed: ${e.message ?: e::class.simpleName ?: "unknown error"}",
                )
            }
        }
        cached = result
        return result
    }

    /** Drops the cache so the next [load] re-reads the document. */
    fun invalidate() {
        cached = null
    }

    /**
     * Most-restrictive-wins capability resolution for one domain on one plane.
     *
     * Returns [Capability.NO] — never an exception, never a default of YES — when:
     * the matrix is unusable, the domain is unknown, the domain is not carried by this
     * plane, or the plane's consent gate is closed. A matrix value of [Capability.YES]
     * cannot open a closed gate.
     *
     * Version/OEM scope is applied downstream as a *result* ([CapabilityResult.
     * NOT_APPLICABLE]), not as a capability downgrade; see §3.5 of the runtime design.
     */
    fun canProbe(domain: String, plane: Plane, authorization: AuthorizationState): Capability {
        val matrix = (load() as? MatrixLoadResult.Loaded)?.matrix ?: return Capability.NO
        val row = matrix.row(domain) ?: return Capability.NO
        if (plane !in row.planes) return Capability.NO
        if (!authorization.isOpen) return Capability.NO
        return row.capability
    }

    /** The recorded Spec §23 result for a domain, or null when the domain is unknown. */
    fun resultOf(domain: String): CapabilityResult? =
        (load() as? MatrixLoadResult.Loaded)?.matrix?.row(domain)?.result

    /** The dispatch class for a domain, or null when the domain is unknown. */
    fun statusOf(domain: String): DomainStatus? =
        (load() as? MatrixLoadResult.Loaded)?.matrix?.row(domain)?.status

    /** Every domain name the matrix declares, in document order. */
    fun domains(): List<String> =
        (load() as? MatrixLoadResult.Loaded)?.matrix?.rows?.map { it.domain }.orEmpty()

    /**
     * Parses and validates the document.
     *
     * Validation is fail-closed: exactly 22 rows, in Spec §21 order, each with a §22
     * capability token and a §23 result token. Any violation makes the whole matrix
     * unusable rather than loading a partial view of it.
     */
    fun parse(markdown: String, sourcePath: String): MatrixLoadResult {
        val violations = mutableListOf<String>()
        val lines = markdown.lines()

        val headerIndex = lines.indexOfFirst {
            it.contains("| # |") && it.contains("Domain") && it.contains("ITEM ID")
        }
        if (headerIndex < 0) {
            return MatrixLoadResult.Unusable("matrix Section 4 header row not found")
        }

        val documentStatus = lines.take(headerIndex)
            .firstOrNull { it.startsWith("Status:") }
            ?.substringAfter("Status:")?.trim().orEmpty()

        val rows = mutableListOf<MatrixDomainRow>()
        for (i in (headerIndex + 2) until lines.size) {
            val line = lines[i].trim()
            if (!line.startsWith("|")) break
            if (line.startsWith("|--") || line.startsWith("| --")) continue

            val cells = splitRow(line)
            val ordinal = rows.size + 1
            if (cells.size < MIN_COLUMNS) {
                violations += "row $ordinal: expected $MIN_COLUMNS columns, found ${cells.size}"
                continue
            }

            val result = CapabilityResult.fromText(cells[RESULT])
                ?: run { violations += "row $ordinal (${cells[DOMAIN]}): no Spec §23 result token in '${cells[RESULT]}'"; null }
                ?: continue
            val capability = CapabilityToken.fromText(cells[CAPABILITY])
                ?: run { violations += "row $ordinal (${cells[DOMAIN]}): no Spec §22 capability token in '${cells[CAPABILITY]}'"; null }
                ?: continue

            val expectedOrdinal = cells[ORDINAL].trim().toIntOrNull()
            if (expectedOrdinal != ordinal) {
                violations += "row $ordinal: ordinal column reads '${cells[ORDINAL].trim()}'"
            }

            rows += MatrixDomainRow(
                ordinal = ordinal,
                domain = cells[DOMAIN].trim(),
                itemId = cells[ITEM_ID].replace("**", "").trim(),
                provisional = cells[ITEM_ID].contains("[P]"),
                capability = capability,
                planes = parsePlanes(cells[PLANES]),
                evidenceType = cells[EVIDENCE_TYPE].replace("**", "").replace("`", "").trim(),
                result = result,
                status = DomainStatus.of(result),
                evidenceReference = cells[EVIDENCE_REF].trim(),
            )
        }

        if (rows.size != SPEC_21_DOMAIN_COUNT) {
            violations += "expected $SPEC_21_DOMAIN_COUNT domains, found ${rows.size}"
        }
        rows.forEachIndexed { index, row ->
            val expected = SPEC_21_DOMAINS.getOrNull(index)
            if (expected != null && !row.domain.equals(expected, ignoreCase = true)) {
                violations += "row ${row.ordinal}: domain '${row.domain}' does not match Spec §21 position ${row.ordinal} ('$expected')"
            }
        }

        if (violations.isNotEmpty()) {
            return MatrixLoadResult.Unusable("matrix validation failed", violations)
        }
        return MatrixLoadResult.Loaded(
            CapabilityMatrix(rows = rows, sourcePath = sourcePath, documentStatus = documentStatus),
        )
    }

    /** Parses the `P1 + P3` style cell. Plain prose such as `physical` yields no plane. */
    private fun parsePlanes(cell: String): Set<Plane> {
        val upper = cell.uppercase()
        return Plane.values()
            .filter { upper.contains(it.matrixLabel) }
            .toSet()
    }

    private fun splitRow(line: String): List<String> {
        var body = line.trim()
        if (body.startsWith("|")) body = body.substring(1)
        if (body.endsWith("|")) body = body.substring(0, body.length - 1)
        return body.split("|").map { it.trim() }
    }

    companion object {
        const val MATRIX_RELATIVE_PATH = "docs/CYVRA_CAPABILITY_MATRIX_V1.md"

        const val SPEC_21_DOMAIN_COUNT = 22

        /** Spec §21, in order. A row out of position is a validation failure. */
        val SPEC_21_DOMAINS = listOf(
            "Connection", "Identity", "Security", "Applications", "Hardware", "Storage",
            "Battery", "Display", "Touch", "Camera", "Audio", "Sensors", "Biometrics",
            "Haptics", "Wi-Fi", "Bluetooth", "Cellular", "GNSS", "Mechanical", "Performance",
            "System", "Sanitization",
        )

        private const val MIN_COLUMNS = 8
        private const val ORDINAL = 0
        private const val DOMAIN = 1
        private const val ITEM_ID = 2
        private const val CAPABILITY = 3
        private const val PLANES = 4
        private const val EVIDENCE_TYPE = 5
        private const val RESULT = 6
        private const val EVIDENCE_REF = 7

        /** Resolves the matrix file by walking up from the working directory. */
        fun resolveDefaultMatrixFile(): File {
            val relative = MATRIX_RELATIVE_PATH
            var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
            while (dir != null) {
                val candidate = File(dir, relative)
                if (candidate.isFile) return candidate
                dir = dir.parentFile
            }
            return File(System.getProperty("user.dir") ?: ".", relative)
        }

        /** Removes Markdown emphasis so token positions are computed on plain text. */
        internal fun flatten(text: String): String =
            text.replace("**", "").replace("`", "").replace("*", "").trim().uppercase()

        /**
         * Earliest matching token in reading order, longest first on a tie.
         *
         * Boundaries are `(?<![A-Z])…(?![A-Z])` rather than `\b`, so `NO` cannot match
         * inside `NOT` and `PASS` cannot match inside `PASSING`.
         */
        internal fun leadingToken(plainUppercase: String, tokens: List<String>): String? {
            var bestToken: String? = null
            var bestPos = Int.MAX_VALUE
            var bestLength = -1
            for (token in tokens) {
                val match = Regex("""(?<![A-Z])${Regex.escape(token)}(?![A-Z])""")
                    .find(plainUppercase) ?: continue
                val pos = match.range.first
                if (pos < bestPos || (pos == bestPos && token.length > bestLength)) {
                    bestToken = token
                    bestPos = pos
                    bestLength = token.length
                }
            }
            return bestToken
        }
    }
}

/**
 * Spec §22 capability tokens, resolved in reading order.
 *
 * Kept separate from [CapabilityResult.fromText] so the `Capability` column and the
 * `Result` column are scanned against their own vocabularies — the two columns share the
 * words `CONDITIONAL` and `ASSISTED`, and conflating them would corrupt every row.
 */
internal object CapabilityToken {
    private val TOKENS = Capability.values().map { it.name }.sortedByDescending { it.length }

    fun fromText(text: String): Capability? {
        val token = CapabilityMatrixLoader.leadingToken(
            CapabilityMatrixLoader.flatten(text),
            TOKENS,
        ) ?: return null
        return Capability.values().firstOrNull { it.name == token }
    }
}
