package cyvra.mobile.host.engine

import cyvra.mobile.host.config.HostSystemProperties
import java.io.File
import java.nio.channels.FileChannel
import java.nio.channels.OverlappingFileLockException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The proposed on-disk record of which patches are **actually applied**.
 *
 * **This format is a proposal, not a governed contract.** Schema §6 step 11 requires the
 * applied set to be written to engine state, but neither §6 nor §7 specifies the record's
 * shape, location, writer, or what makes it authoritative. The fields below are the
 * smallest set that satisfies everything the schema *does* say, and are recorded in
 * `docs/CYVRA_PATCH_STATE_PROVIDER.md` §4 for Chief Engineer ratification. Until that
 * ratification this format is not in force and [PatchStateStore] is not wired into
 * production.
 *
 * @param sequence strictly monotonic per state root. A record whose sequence is not
 *   greater than the one already committed is **stale** and is refused on write, so an
 *   interrupted or replayed update can never walk the applied set backwards.
 * @param appliedPatches provenance for each applied patch: not just that it was applied,
 *   but which envelope it came from (`payloadSha256`, `keyId`, `envelopeSchemaVersion`)
 *   and which live device scope it was applied against (`matchedDevice`).
 */
@Serializable
data class AppliedStateRecord(
    val schemaVersion: String = RECORD_SCHEMA_VERSION,
    val sequence: Long,
    val patchSetVersion: String,
    val patchSetHash: String,
    val patchSetMode: String,
    val rollbackReason: String? = null,
    val engineVersion: String,
    val writtenAt: String,
    val appliedPatches: List<AppliedEntry> = emptyList(),
) {
    companion object {
        const val RECORD_SCHEMA_VERSION: String = "1.0"
    }
}

/** Provenance for one applied patch. Mirrors contract §6 step 11 plus the scope it matched. */
@Serializable
data class AppliedEntry(
    val patchId: String,
    val payloadSha256: String,
    val keyId: String,
    val envelopeSchemaVersion: String,
    val matchedDevice: String,
    val appliedAt: String,
    val rolledBackAt: String? = null,
)

/**
 * A requested patch-state transition: one application, or one rollback.
 *
 * Carries what actually happened. It is an ordinary value — constructing one records
 * nothing, because [PatchStateStore.persist] will not write until
 * [PatchApplicationAuthoriser] authorises it.
 *
 * @param patch the verified patch to apply. Null for a rollback.
 * @param device the live device scope it was applied against. Null for a rollback.
 */
class PatchStateTransition(
    val kind: Kind,
    val patch: VerifiedPatch?,
    val device: DeviceProfile?,
    val rollbackReason: String? = null,
) {
    enum class Kind { APPLY, ROLLBACK }
}

/**
 * Decides whether a requested transition may be recorded as having happened.
 *
 * The mirror of [AppliedStateAuthenticator] on the write side. It is the single place
 * that answers "did an application actually occur?", so the ability to *record* an
 * application and the ability to *perform* one cannot drift apart.
 */
fun interface PatchApplicationAuthoriser {
    /** Returns null to authorise the transition, or a reason to refuse it. */
    fun authorise(transition: PatchStateTransition): String?
}

/**
 * The production authoriser: it authorises nothing, because nothing can apply a patch.
 *
 * Contract §6 step 10 is "stage full set, re-validate, swap atomically", but the engine has
 * **no procedure registry** — a patch's `procedure_overrides[]` name a `procedure_id` and
 * an `action`, yet no component resolves a `procedure_id` to executable behaviour, and
 * [VerifiedPatch] never leaves `PatchVerifier.kt`. There is consequently no application to
 * authorise, and recording one would fabricate evidence of work that was never done.
 *
 * The component that performs the transition and replaces this object would be built in
 * the same change, so the product can never gain the ability to *claim* an application
 * before it gains the ability to *make* one.
 */
object NoGovernedPatchApplicationAuthoriser : PatchApplicationAuthoriser {
    override fun authorise(transition: PatchStateTransition): String? =
        "PATCH_APPLICATION_BOUNDARY_MISSING: the engine has no procedure registry or patch- " +
            "application step, so no transition can be authorised as having occurred"
}

/** Result of attempting to persist an applied-state record. */
sealed interface PatchPersistOutcome {
    data class Persisted(val sequence: Long) : PatchPersistOutcome

    /** Nothing was written, and any previously committed record still stands. */
    data class Refused(val reason: String) : PatchPersistOutcome
}

/**
 * Decides whether a persisted applied-state record may be treated as authoritative.
 *
 * Contract §5.6 keeps trust anchors and the authorisation gate outside patch reach; this
 * seam exists for the same reason. It is injectable so that the decision can be supplied
 * by whatever the Chief Engineer governs, rather than being baked in here.
 */
fun interface AppliedStateAuthenticator {
    /** [reason] on refusal. A caller MUST NOT treat an unauthenticated record as state. */
    fun authenticate(record: AppliedStateRecord): String?
}

/**
 * The production authenticator today: it authenticates nothing, because nothing governs
 * an applied-state record yet.
 *
 * **Why no local record can self-authenticate.** `cyvra.home` is writable by the signed-in
 * operator, and the Ed25519 private key is held off-device by the named custodian, so the
 * engine cannot sign an assertion of the form "this patch was applied". A signature from
 * the patch key can authorise **which** set may be applied; it can never attest **that** a
 * set was applied, because application is a local runtime fact that happens without the
 * custodian present. Until a governed binding exists (a hardware-rooted attestation, or an
 * uplink that countersigns), every local record is unauthenticated and must be refused.
 */
object UngovernedAppliedStateAuthenticator : AppliedStateAuthenticator {
    override fun authenticate(record: AppliedStateRecord): String? =
        "APPLIED_STATE_UNAUTHENTICATED: no governed binding exists for a local applied-state " +
            "record, so it cannot be treated as authoritative (cyvra.home is operator-writable " +
            "and the signing key is held off-device by the custodian)"
}

/**
 * Crash-safe persistence for the applied patch set, under the writable state root.
 *
 * ## The missing execution boundary
 *
 * This class persists and validates. It deliberately **does not apply anything**, because
 * there is nothing for it to be connected to:
 *
 *  - The engine has **no procedure registry**. A patch's `procedure_overrides[]` name a
 *    `procedure_id` and an `action`, but no component resolves a `procedure_id` to
 *    executable behaviour — `procedure_id` is read only inside [PatchVerifier], for schema
 *    validation and the authorisation-gate keyword scan.
 *  - [VerifiedPatch] never leaves `PatchVerifier.kt`. Nothing consumes a verified patch to
 *    change engine behaviour.
 *  - Contract §6 step 10 ("stage full set, re-validate, swap atomically") therefore has no
 *    set to swap and step 11 has no event to record.
 *
 * So the boundary that is missing is the **patch-application step**: the component that
 * takes a [VerifiedPatch], executes its overrides against real procedures, and then mints
 * the [PatchStateTransition] that authorises this store to record the fact. Building that
 * is a separate, governed task.
 *
 * ## What is enforced here
 *
 *  - **Atomicity.** Written to a sibling `.tmp`, then renamed. A crash mid-write leaves the
 *    previously committed record intact; an orphaned `.tmp` is never read as state.
 *  - **Single writer.** An exclusive lock on the state file is held for the whole
 *    read-modify-write. A second writer is refused rather than racing.
 *  - **Staleness.** [AppliedStateRecord.sequence] must strictly increase.
 *  - **Consistency.** Hash/mode invariants are checked before a record is accepted.
 *  - **Authentication.** Every read passes [authenticator]; production refuses.
 *  - **Authorisation.** [persist] passes the requested transition to [authoriser], whose
 *    production implementation refuses, so no caller can record an application that did
 *    not happen.
 *
 * **This class is not wired into production.** Wiring requires the format to be ratified,
 * the execution boundary to exist, and a governed authentication binding — none of which
 * are in place.
 */
class PatchStateStore(
    private val stateRoot: () -> String? = {
        System.getProperty(HostSystemProperties.STATE_HOME_PROPERTY)
    },
    private val engineVersion: String,
    private val authenticator: AppliedStateAuthenticator = UngovernedAppliedStateAuthenticator,
    private val authoriser: PatchApplicationAuthoriser = NoGovernedPatchApplicationAuthoriser,
    private val clock: () -> Instant = { Instant.now() },
) : AppliedPatchStateSource {

    private val json = Json { ignoreUnknownKeys = false; encodeDefaults = true }

    /** The committed record. Implements the provider's source seam. */
    override fun read(): PatchStateOutcome {
        val root = stateRoot()?.takeIf { it.isNotBlank() }
            ?: return PatchStateOutcome.Unavailable(
                "STATE_ROOT_UNSET: ${HostSystemProperties.STATE_HOME_PROPERTY} is not supplied",
            )

        val directory = File(root, STATE_DIRECTORY)
        val committed = File(directory, RECORD_FILE)
        val orphaned = File(directory, RECORD_FILE + TMP_SUFFIX)

        // Recovery: a `.tmp` is a write that never completed. It is evidence of an
        // interrupted write, never of applied state. Remove it and carry on, because the
        // committed file — if any — is still the authoritative record.
        if (orphaned.exists() && !orphaned.delete()) {
            return PatchStateOutcome.Unavailable(
                "APPLIED_STATE_RECOVERY_FAILED: could not clear the interrupted write " +
                    "${orphaned.name}; refusing rather than guessing which record is live",
            )
        }

        if (!committed.isFile) {
            return PatchStateOutcome.Unavailable(
                "APPLIED_STATE_RECORD_MISSING: no applied-state record has ever been " +
                    "committed, so the applied set cannot be established",
            )
        }

        val record = try {
            json.decodeFromString(AppliedStateRecord.serializer(), committed.readText(Charsets.UTF_8))
        } catch (error: Exception) {
            return PatchStateOutcome.Unavailable(
                "APPLIED_STATE_RECORD_CORRUPT: ${committed.name} could not be parsed: ${error.message}",
            )
        }

        consistencyViolation(record)?.let {
            return PatchStateOutcome.Unavailable("APPLIED_STATE_INCONSISTENT: $it")
        }

        authenticator.authenticate(record)?.let {
            return PatchStateOutcome.Unavailable(it)
        }

        return PatchStateOutcome.Established(record.toPatchSetState())
    }

    /**
     * Commits a new applied-set record atomically.
     *
     * Returns [PatchPersistOutcome.Refused] — leaving any previously committed record
     * untouched — whenever the transition is not authorised, is itself invalid, or the
     * state directory could not be locked.
     */
    fun persist(transition: PatchStateTransition): PatchPersistOutcome {
        // The security decision comes first and fails closed: nothing touches the
        // filesystem on a transition no authoriser recognises as having occurred.
        authoriser.authorise(transition)?.let {
            return PatchPersistOutcome.Refused(it)
        }

        val root = stateRoot()?.takeIf { it.isNotBlank() }
            ?: return PatchPersistOutcome.Refused(
                "STATE_ROOT_UNSET: ${HostSystemProperties.STATE_HOME_PROPERTY} is not supplied",
            )

        val directory = File(root, STATE_DIRECTORY)
        if (!directory.isDirectory && !directory.mkdirs()) {
            return PatchPersistOutcome.Refused("APPLIED_STATE_DIRECTORY_UNWRITABLE: ${directory.path}")
        }

        /*
         * Single writer, held on a DEDICATED lock file rather than on the record itself.
         *
         * Locking the record would keep it open for the whole read-modify-write, and
         * Windows refuses to rename over an open handle — the atomic replace would fail on
         * every call. The lock file is never renamed, so it can stay open without blocking
         * the swap, and it is created before any validation so a refused transition never
         * leaves a half-formed record behind.
         */
        val lockChannel = try {
            FileChannel.open(
                File(directory, LOCK_FILE).toPath(),
                StandardOpenOption.CREATE,
                StandardOpenOption.READ,
                StandardOpenOption.WRITE,
            )
        } catch (error: Exception) {
            return PatchPersistOutcome.Refused("APPLIED_STATE_LOCK_FAILED: ${error.message}")
        }

        return lockChannel.use { channel ->
            val lease = try {
                channel.tryLock()
            } catch (error: OverlappingFileLockException) {
                null
            }
            if (lease == null) {
                PatchPersistOutcome.Refused(
                    "APPLIED_STATE_WRITER_BUSY: another writer holds the applied-state lock",
                )
            } else {
                lease.use { commitUnderLock(directory, transition) }
            }
        }
    }

    /** The read-modify-replace half, executed with the single-writer lock already held. */
    private fun commitUnderLock(directory: File, transition: PatchStateTransition): PatchPersistOutcome {
        val committed = File(directory, RECORD_FILE)
        val orphaned = File(directory, RECORD_FILE + TMP_SUFFIX)

        // Recovery, under the lock so two writers cannot race over the same orphan. A
        // `.tmp` is an interrupted write, never evidence of applied state.
        if (orphaned.exists() && !orphaned.delete()) {
            return PatchPersistOutcome.Refused(
                "APPLIED_STATE_RECOVERY_FAILED: could not clear the interrupted write ${orphaned.name}",
            )
        }

        /*
         * Build and validate the next record BEFORE anything is written, so a refused
         * transition leaves the directory exactly as it was rather than merely leaving the
         * committed record intact.
         */
        val next = try {
            nextRecord(readCommitted(committed), transition)
        } catch (error: IllegalStateException) {
            return PatchPersistOutcome.Refused(error.message ?: "refused")
        }

        try {
            Files.write(
                orphaned.toPath(),
                json.encodeToString(AppliedStateRecord.serializer(), next).toByteArray(Charsets.UTF_8),
            )
            Files.move(
                orphaned.toPath(),
                committed.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        } catch (error: AtomicMoveNotSupportedException) {
            orphaned.delete()
            return PatchPersistOutcome.Refused(
                "APPLIED_STATE_NOT_ATOMIC: ${error.message}; refusing a non-atomic replace",
            )
        } catch (error: Exception) {
            orphaned.delete()
            // The previous committed record is deliberately left in place: a failed update
            // must preserve the last valid state rather than blanking it.
            return PatchPersistOutcome.Refused("APPLIED_STATE_WRITE_FAILED: ${error.message}")
        }

        return PatchPersistOutcome.Persisted(next.sequence)
    }

    private fun readCommitted(committed: File): AppliedStateRecord? {
        if (!committed.isFile) return null
        return try {
            json.decodeFromString(AppliedStateRecord.serializer(), committed.readText(Charsets.UTF_8))
        } catch (error: Exception) {
            null
        }
    }

    private fun nextRecord(current: AppliedStateRecord?, transition: PatchStateTransition): AppliedStateRecord {
        val now = clock()
        val nextSequence = (current?.sequence ?: 0L) + 1L

        val applied = when (transition.kind) {
            PatchStateTransition.Kind.APPLY -> {
                val patch = checkNotNull(transition.patch)
                val device = checkNotNull(transition.device)
                current.orEmptyEntries() + AppliedEntry(
                    patchId = patch.patchId,
                    payloadSha256 = patch.payloadSha256,
                    keyId = patch.keyId,
                    envelopeSchemaVersion = ENVELOPE_SCHEMA_VERSION,
                    matchedDevice = "${device.manufacturer}/${device.model}/api${device.apiLevel}",
                    appliedAt = now.toString(),
                )
            }

            PatchStateTransition.Kind.ROLLBACK -> {
                val reason = checkNotNull(transition.rollbackReason)
                if (reason.isBlank()) {
                    throw IllegalStateException("APPLIED_STATE_ROLLBACK_WITHOUT_REASON")
                }
                val stamp = now.toString()
                current.orEmptyEntries().map { entry ->
                    if (entry.rolledBackAt == null) entry.copy(rolledBackAt = stamp) else entry
                }
            }
        }

        val active = applied.filter { it.rolledBackAt == null }
        val mode = when {
            applied.isEmpty() -> PatchSetMode.NO_PATCHES
            transition.kind == PatchStateTransition.Kind.ROLLBACK && active.isEmpty() ->
                PatchSetMode.SIGNED_ROLLED_BACK
            else -> PatchSetMode.SIGNED_CURRENT
        }

        /*
         * Version follows the governed semantics of PatchSetState.with()/rollback()
         * exactly, so a persisted record and an in-memory set never disagree about how a
         * patch-set version is derived.
         */
        val version = when {
            applied.isEmpty() -> PatchSetMode.NO_PATCHES.wireName
            transition.kind == PatchStateTransition.Kind.ROLLBACK ->
                PatchSetState.nextVersion(applied.size + 1, now)
            else -> PatchSetState.nextVersion(applied.size, now)
        }

        return AppliedStateRecord(
            sequence = nextSequence,
            patchSetVersion = version,
            patchSetHash = PatchSetState.computeHash(
                active.map {
                    AppliedPatch(
                        patchId = it.patchId,
                        sha256 = it.payloadSha256,
                        keyId = it.keyId,
                        appliedAt = it.appliedAt,
                        rolledBackAt = it.rolledBackAt,
                    )
                },
            ),
            patchSetMode = mode.wireName,
            rollbackReason = when (mode) {
                PatchSetMode.SIGNED_ROLLED_BACK -> transition.rollbackReason
                else -> null
            },
            engineVersion = engineVersion,
            writtenAt = now.toString(),
            appliedPatches = applied,
        )
    }

    private fun AppliedStateRecord?.orEmptyEntries(): List<AppliedEntry> = this?.appliedPatches.orEmpty()

    private fun consistencyViolation(record: AppliedStateRecord): String? {
        if (record.schemaVersion != AppliedStateRecord.RECORD_SCHEMA_VERSION) {
            return "unsupported record schema_version '${record.schemaVersion}'"
        }
        if (record.sequence < 1L) {
            return "sequence must be a positive counter, was ${record.sequence}"
        }

        val mode = PatchSetMode.values().firstOrNull { it.wireName == record.patchSetMode }
            ?: return "unknown patch_set_mode '${record.patchSetMode}'"

        val active = record.appliedPatches.filter { it.rolledBackAt == null }
        val expectedHash = PatchSetState.computeHash(
            active.map {
                AppliedPatch(
                    patchId = it.patchId,
                    sha256 = it.payloadSha256,
                    keyId = it.keyId,
                    appliedAt = it.appliedAt,
                    rolledBackAt = it.rolledBackAt,
                )
            },
        )
        if (record.patchSetHash != expectedHash) {
            return "patch_set_hash does not match the recorded applied patches"
        }

        return when (mode) {
            PatchSetMode.NO_PATCHES ->
                if (record.appliedPatches.isNotEmpty()) {
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
                if (record.rollbackReason.isNullOrBlank()) {
                    "SIGNED_ROLLED_BACK is declared without a rollback reason"
                } else {
                    null
                }
        }
    }

    private fun AppliedStateRecord.toPatchSetState(): PatchSetState = PatchSetState(
        version = patchSetVersion,
        hash = patchSetHash,
        mode = PatchSetMode.values().first { it.wireName == patchSetMode },
        appliedPatches = appliedPatches.map {
            AppliedPatch(
                patchId = it.patchId,
                sha256 = it.payloadSha256,
                keyId = it.keyId,
                appliedAt = it.appliedAt,
                rolledBackAt = it.rolledBackAt,
            )
        },
        rollbackReason = rollbackReason,
    )

    companion object {
        /** Writable state sub-directory beneath `cyvra.home`. */
        const val STATE_DIRECTORY: String = "patches"

        const val RECORD_FILE: String = "applied-state.json"

        const val TMP_SUFFIX: String = ".tmp"

        /**
         * Single-writer lock file. Deliberately not the record itself: the record is
         * renamed during commit, and Windows cannot rename over an open handle.
         */
        const val LOCK_FILE: String = "applied-state.lock"

        /** Schema §5 pins the envelope payload schema; recorded as application provenance. */
        const val ENVELOPE_SCHEMA_VERSION: String = "1.0"
    }
}
