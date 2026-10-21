package cyvra.mobile.host.engine

import cyvra.mobile.host.config.HostSystemProperties
import java.io.File
import java.time.Instant

/**
 * What a patch-state source is allowed to answer (contract 8: `patch_set_mode` is
 * "never blank, never inferred").
 *
 * Kept distinct so that these cases can never be confused with one another:
 *
 *  1. **[Established] with a non-empty set** — version, hash, mode and history all
 *     derived from genuinely verified/applied records.
 *  2. **[Established] with a verified empty set** — `NO-PATCHES` is reportable *only*
 *     here, i.e. when the source positively established from a trusted, valid record
 *     that the applied set is genuinely empty.
 *  3. **[Unavailable]** — missing corpus, missing state record, unreadable or corrupt
 *     persistence, unknown key, bad signature, or failed verification. Carries a
 *     reason for diagnostics and is **never** reinterpreted as an empty set.
 *
 * The distinction between (2) and (3) is the whole point of the type. [cyvra.mobile.host
 * .engine.PatchSetState]'s own default *is* `NO-PATCHES`, so a component that merely
 * failed to find anything could otherwise hand back that default and have it reported as
 * an authoritative claim about a customer's device. Forcing a positive [Established]
 * makes the permissive fallback structurally impossible rather than a convention to be
 * remembered.
 *
 * This type records no trust of its own: only a source backed by governed anchors and
 * genuine application evidence may ever construct [Established].
 */
sealed interface PatchStateOutcome {
    /** The source positively established this state from a trusted, valid record. */
    data class Established(val state: PatchSetState) : PatchStateOutcome

    /** Nothing authoritative could be established. [reason] is diagnostic only. */
    data class Unavailable(val reason: String) : PatchStateOutcome
}

/**
 * Reads the record of which patches are **actually applied** to this engine.
 *
 * Contract 6 step 10-11 stages a verified patch set, then records the applied `patch_id`
 * and `key_id` to engine state. Verifying a corpus proves a patch is *valid*; it never
 * proves the patch was *applied*. The two claims are kept separate on purpose: a
 * delivered-but-not-yet-applied patch is not part of the applied set and must not be
 * reported as one.
 *
 * Implementations MUST honour two rules:
 *
 *  - Return [PatchStateOutcome.Unavailable] — never a default [PatchSetState] — whenever
 *    the record is absent, unreadable, corrupt or unparseable. Returning the type's own
 *    default would report "no patches" as an authoritative fact.
 *  - Return [PatchStateOutcome.Established] only when an actual persisted record was
 *    read and validated.
 */
fun interface AppliedPatchStateSource {
    fun read(): PatchStateOutcome
}

/**
 * The production applied-state source today: it reads nothing, because there is nothing
 * governed to read.
 *
 * **Contract gap.** Contract 6 step 11 requires the applied set to be "written to engine
 * state", but:
 *
 *  - no on-disk format for that record is specified anywhere in the schema, and
 *  - no production patch-application or rollback lifecycle exists to write one —
 *    `PatchSetState.with(...)` and `PatchSetState.rollback(...)` have **zero** production
 *    callers; both are used only by their own tests.
 *
 * Declaring a format here would be inventing a production protocol, which contract 9
 * leaves open. So this source answers [PatchStateOutcome.Unavailable] and the applied set
 * is established from nothing. Once an apply lifecycle and a governed record format
 * exist, the real source replaces this object at the single injection point in
 * `HostMain`.
 */
object NoGovernedAppliedStateSource : AppliedPatchStateSource {
    override fun read(): PatchStateOutcome = PatchStateOutcome.Unavailable(
        "APPLIED_STATE_FORMAT_NOT_GOVERNED: contract 6 step 11 requires an applied-state " +
            "record, but no format is governed and no production apply/rollback lifecycle " +
            "exists to write one",
    )
}

/**
 * Establishes the authoritative applied patch state for a completed scan, from the
 * governed read-only installation root only.
 *
 * Contract 3 forbids a network fetch inside the actuation path, so the corpus is read
 * from `<cyvra.install>/patches` — the same read-only root that resolves `adb.exe`,
 * which `HostSystemProperties` exists to keep out of any directory a local account may
 * write to. A patch corpus an operator could edit is not evidence.
 *
 * [establish] runs the gates below in order and returns [PatchStateOutcome.Unavailable]
 * with a distinct reason at the first one that fails. It returns
 * [PatchStateOutcome.Established] **only** when every gate passed, so a production
 * deployment with no approved trust anchor (today's state) cannot reach the end.
 *
 *  1. **Trust anchors (contract 3).** An empty registry refuses before any file is read.
 *  2. **Installation root.** Unset or blank refuses.
 *  3. **Corpus directory.** Missing refuses.
 *  4. **Corpus contents.** An absent or empty corpus is **not** `NO-PATCHES` — it is an
 *     absence of evidence, and refuses.
 *  5. **Verification (contract 6).** Every envelope is verified by the existing
 *     [PatchVerifier] — never a second implementation. Any rejection refuses the whole
 *     corpus; out-of-scope patches are retained as NOT APPLICABLE and exert no effect.
 *  6. **Application evidence.** Verification is not application; [appliedStateSource]
 *     must positively produce the applied record.
 *  7. **Reconciliation.** Every active applied record must match a patch that this
 *     corpus verified, on both `patch_id` and payload hash, and be internally
 *     consistent. Anything else refuses.
 *
 * @param device the live device for contract 6 step 7. When absent every patch is
 *   legitimately NOT APPLICABLE, so no applied record can be reconciled against the
 *   corpus.
 */
class FileBasedPatchStateProvider(
    private val engineVersion: String,
    private val installationRoot: () -> String? = {
        System.getProperty(HostSystemProperties.INSTALLATION_ROOT_PROPERTY)
    },
    private val matrixLoader: CapabilityMatrixLoader = CapabilityMatrixLoader(),
    private val trustAnchors: Map<String, TrustAnchor> = PatchTrustAnchors.ALL,
    private val appliedStateSource: AppliedPatchStateSource = NoGovernedAppliedStateSource,
    private val clock: () -> Instant = { Instant.now() },
) {

    fun establish(device: DeviceProfile? = null): PatchStateOutcome {
        // Gate 1 — contract 3. Refuse before touching the filesystem.
        if (trustAnchors.isEmpty()) {
            return PatchStateOutcome.Unavailable(
                "NO_APPROVED_TRUST_ANCHOR: the build-time trust-anchor registry is empty, " +
                    "so no signed patch can be verified (contract 3; custody is open item 9.1)",
            )
        }

        // Gate 2 — the governed read-only root the workstation supplies.
        val root = installationRoot()?.takeIf { it.isNotBlank() }
            ?: return PatchStateOutcome.Unavailable(
                "INSTALL_ROOT_UNSET: ${HostSystemProperties.INSTALLATION_ROOT_PROPERTY} is " +
                    "not supplied, so no patch corpus can be resolved",
            )

        // Gate 3/4 — corpus presence. Absence is never `NO-PATCHES`.
        val corpusDirectory = File(root, PATCH_CORPUS_DIRECTORY)
        if (!corpusDirectory.isDirectory) {
            return PatchStateOutcome.Unavailable(
                "PATCH_CORPUS_MISSING: no corpus directory at $PATCH_CORPUS_DIRECTORY under " +
                    "the installation root",
            )
        }
        val envelopes = corpusDirectory.listFiles { entry -> entry.isFile && entry.name.endsWith(".json") }
            ?.sortedBy { it.name }
            ?: return PatchStateOutcome.Unavailable(
                "PATCH_CORPUS_UNREADABLE: $PATCH_CORPUS_DIRECTORY could not be listed",
            )
        if (envelopes.isEmpty()) {
            return PatchStateOutcome.Unavailable(
                "PATCH_CORPUS_EMPTY: the corpus holds no envelope, which is an absence of " +
                    "evidence and is never reported as NO-PATCHES",
            )
        }

        // Gate 5 — contract 6, ordered and fail-closed, via the existing verifier.
        val verifier = PatchVerifier(
            engineVersion = engineVersion,
            trustAnchors = trustAnchors,
            knownMatrixRows = ::knownMatrixRowIds,
            clock = clock,
        )
        val accepted = mutableListOf<VerifiedPatch>()
        for (envelope in envelopes) {
            val bytes = try {
                envelope.readBytes()
            } catch (error: Exception) {
                return PatchStateOutcome.Unavailable(
                    "PATCH_ENVELOPE_UNREADABLE: ${envelope.name}: ${error.message}",
                )
            }
            when (val result = verifier.verify(bytes, device = device)) {
                is PatchVerificationResult.Accepted -> accepted += result.patch
                // Contract 6.7 / Spec 82: out of scope is retained and inert, never a
                // pass and never a failure.
                is PatchVerificationResult.NotApplicable -> Unit
                is PatchVerificationResult.Rejected ->
                    return PatchStateOutcome.Unavailable(
                        "PATCH_REJECTED_${result.reason.name}: ${envelope.name}: ${result.detail}",
                    )
            }
        }

        // Gate 6 — a verified corpus is not proof that anything was applied.
        val sourceOutcome = appliedStateSource.read()
        if (sourceOutcome !is PatchStateOutcome.Established) {
            return sourceOutcome
        }

        // Gate 7 — the record must reconcile with what this corpus verified.
        val verifiedById = accepted.associateBy { it.patchId }
        val uncorroborated = sourceOutcome.state.appliedPatches.filter { record ->
            record.rolledBackAt == null && verifiedById[record.patchId]?.payloadSha256 != record.sha256
        }
        if (uncorroborated.isNotEmpty()) {
            return PatchStateOutcome.Unavailable(
                "APPLIED_PATCH_NOT_IN_VERIFIED_CORPUS: the applied-state record names " +
                    "${uncorroborated.joinToString(", ") { it.patchId }} with no matching " +
                    "verified envelope in the corpus",
            )
        }

        consistencyViolation(sourceOutcome.state)?.let { violation ->
            return PatchStateOutcome.Unavailable("APPLIED_STATE_INCONSISTENT: $violation")
        }

        return PatchStateOutcome.Established(sourceOutcome.state)
    }

    /**
     * Contract §6 step 8 resolves `matrix_rows[]` against the capability matrix.
     *
     * The ids supplied are [MatrixDomainRow.rowId] — the stable bare id (`CON-001`), not
     * the marked `itemId` (`CON-001 [S]`). The `[S]`/`[P]` marker is ratification status
     * that changes over time while the id does not, so resolving against the marker would
     * reject a patch at the moment its row was ratified. See [MatrixDomainRow.rowId].
     *
     * Ids are taken verbatim from the matrix; nothing is case-folded, trimmed of markers
     * or otherwise normalised here, so `PATCH_ROW_UNKNOWN` keeps rejecting exactly what
     * the matrix cannot resolve.
     *
     * A patch that quoted the illustrative ids from schema §5.1 (`ADB-GETPROP-READ`) is
     * rejected `PATCH_ROW_UNKNOWN`: that example is labelled "EXAMPLE ONLY" and schema §9.3
     * defers the real vocabulary to the capability matrix, which this reads.
     */
    private fun knownMatrixRowIds(): Set<String> = when (val loaded = matrixLoader.load()) {
        is MatrixLoadResult.Loaded -> loaded.matrix.rows.map { it.rowId }.toSet()
        // MATRIX-UNUSABLE: with no resolvable rows every patch fails step 8 rather than
        // being matched against rows the engine cannot read.
        is MatrixLoadResult.Unusable -> emptySet()
    }

    /**
     * Rejects a record whose fields contradict one another, so a corrupted or tampered
     * persisted record cannot be presented as an authoritative applied set.
     */
    private fun consistencyViolation(state: PatchSetState): String? {
        val active = state.appliedPatches.filter { it.rolledBackAt == null }
        if (state.hash != PatchSetState.computeHash(active)) {
            return "patch_set_hash does not match the recorded applied patches"
        }
        return when (state.mode) {
            PatchSetMode.NO_PATCHES ->
                if (state.appliedPatches.isNotEmpty()) {
                    "NO_PATCHES is declared but applied records are present"
                } else {
                    null
                }

            PatchSetMode.SIGNED_CURRENT ->
                if (active.isEmpty()) {
                    "SIGNED_CURRENT is declared but no patch is actively applied"
                } else {
                    null
                }

            PatchSetMode.SIGNED_ROLLED_BACK ->
                if (state.rollbackReason.isNullOrBlank()) {
                    "SIGNED_ROLLED_BACK is declared without a rollback reason"
                } else {
                    null
                }
        }
    }

    companion object {
        /**
         * Relative corpus location beneath `cyvra.install`.
         *
         * Contract 3 places public keys and the corpus in the engine's governed,
         * build-time material, and contract 9.2 defers a distribution endpoint to a later
         * phase — so the corpus ships inside the signed installation and is read from
         * there.
         */
        const val PATCH_CORPUS_DIRECTORY: String = "patches"
    }
}
