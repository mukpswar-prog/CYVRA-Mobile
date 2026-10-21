package cyvra.mobile.host.engine

import java.io.File
import java.nio.file.Files
import java.time.Instant
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/**
 * Tests for [PatchStateStore].
 *
 * Every test supplies an approving [PatchApplicationAuthoriser] and/or
 * [AppliedStateAuthenticator]. Production supplies neither — it uses
 * [NoGovernedPatchApplicationAuthoriser] and [UngovernedAppliedStateAuthenticator], both of
 * which refuse — so exercising the persistence mechanics here never widens what the
 * product will accept.
 *
 * No test key, fixture record or generated state is promoted anywhere: nothing in this
 * file is written to a production location or read by production code, because the store
 * is not wired in.
 */
class PatchStateStoreTest {

    private val now: Instant = Instant.parse("2026-10-09T00:00:00Z")
    private val stateRoot: File = Files.createTempDirectory("cyvra-applied-state").toFile()
    private val device = DeviceProfile(manufacturer = "samsung", model = "SM-A107F", apiLevel = 31)

    private val approving: AppliedStateAuthenticator = AppliedStateAuthenticator { null }
    private val authorising: PatchApplicationAuthoriser = PatchApplicationAuthoriser { null }

    private val recordFile: File
        get() = File(File(stateRoot, PatchStateStore.STATE_DIRECTORY), PatchStateStore.RECORD_FILE)

    @AfterTest
    fun removeStateRoot() {
        stateRoot.deleteRecursively()
    }

    // --------------------------------------------------------------- fixtures

    private fun store(
        authenticator: AppliedStateAuthenticator = approving,
        authoriser: PatchApplicationAuthoriser = authorising,
        root: () -> String? = { stateRoot.absolutePath },
    ) = PatchStateStore(
        stateRoot = root,
        engineVersion = "1.0.0",
        authenticator = authenticator,
        authoriser = authoriser,
        clock = { now },
    )

    private fun verifiedPatch(patchId: String = "PATCH-ADB-20261009-1", sha: String = "a".repeat(64)) =
        VerifiedPatch(
            patchId = patchId,
            keyId = "test-key",
            payload = JsonObject(emptyMap()),
            payloadSha256 = sha,
            engineMinVersion = "1.0.0",
            matrixRows = listOf("CON-001"),
            procedureOverrides = emptyList(),
            oemScope = OemScope("samsung", listOf("SM-A107F"), 30, 34, emptyList()),
        )

    private fun applyTransition(patchId: String = "PATCH-ADB-20261009-1", sha: String = "a".repeat(64)) =
        PatchStateTransition(PatchStateTransition.Kind.APPLY, verifiedPatch(patchId, sha), device)

    private fun rollbackTransition(reason: String = "contract §7 rollback") =
        PatchStateTransition(PatchStateTransition.Kind.ROLLBACK, patch = null, device = null, rollbackReason = reason)

    private fun refusal(outcome: PatchStateOutcome): String =
        (outcome as? PatchStateOutcome.Unavailable)?.reason ?: fail("expected Unavailable, was $outcome")

    private fun refusal(outcome: PatchPersistOutcome): String =
        (outcome as? PatchPersistOutcome.Refused)?.reason ?: fail("expected Refused, was $outcome")

    private fun established(outcome: PatchStateOutcome): PatchSetState =
        (outcome as? PatchStateOutcome.Established)?.state ?: fail("expected Established, was $outcome")

    // ----------------------------------------------------- refusal: read side

    @Test
    fun refusesWhenTheStateRootIsNotSupplied() {
        val reason = refusal(store(root = { null }).read())

        assertTrue(reason.startsWith("STATE_ROOT_UNSET"), "was: $reason")
    }

    @Test
    fun refusesWhenNoRecordHasEverBeenCommitted() {
        // Absence of a record is never NO-PATCHES.
        val reason = refusal(store().read())

        assertTrue(reason.startsWith("APPLIED_STATE_RECORD_MISSING"), "was: $reason")
    }

    @Test
    fun refusesACorruptRecord() {
        recordFile.parentFile.mkdirs()
        recordFile.writeText("{ this is not a record }", Charsets.UTF_8)

        val reason = refusal(store().read())

        assertTrue(reason.startsWith("APPLIED_STATE_RECORD_CORRUPT"), "was: $reason")
    }

    @Test
    fun refusesARecordWhoseHashDoesNotMatchItsEntries() {
        writeRawRecord(
            sequence = 1L,
            patchSetMode = "NO-PATCHES",
            patchSetHash = "0".repeat(64),
        )

        val reason = refusal(store().read())

        assertTrue(reason.startsWith("APPLIED_STATE_INCONSISTENT"), "was: $reason")
    }

    @Test
    fun refusesAnUnauthenticatedRecordByDefault() {
        // The production authenticator must refuse even a perfectly well-formed record:
        // a local file under cyvra.home cannot attest its own application.
        val persisted = store().persist(applyTransition())
        assertTrue(persisted is PatchPersistOutcome.Persisted, "setup persist failed: $persisted")

        val reason = refusal(
            PatchStateStore(
                stateRoot = { stateRoot.absolutePath },
                engineVersion = "1.0.0",
                // authenticator defaults to UngovernedAppliedStateAuthenticator
                authoriser = authorising,
                clock = { now },
            ).read(),
        )

        assertTrue(reason.startsWith("APPLIED_STATE_UNAUTHENTICATED"), "was: $reason")
    }

    @Test
    fun refusesAnUnsupportedRecordSchemaVersion() {
        writeRawRecord(sequence = 1L, schemaVersion = "9.9", patchSetMode = "NO-PATCHES")

        val reason = refusal(store().read())

        assertTrue(reason.contains("schema_version"), "was: $reason")
    }

    @Test
    fun refusesARollbackRecordThatCarriesNoRollbackReason() {
        writeRawRecord(
            sequence = 1L,
            patchSetMode = "SIGNED-ROLLED-BACK",
            rollbackReason = null,
            appliedPatches = listOf(
                """{"patchId":"PATCH-ADB-20261009-1","payloadSha256":"${"a".repeat(64)}","keyId":"k",""" +
                    """"envelopeSchemaVersion":"1.0","matchedDevice":"m/m/api1","appliedAt":"2026-10-09T00:00:00Z",""" +
                    """"rolledBackAt":"2026-10-09T00:00:00Z"}""",
            ),
        )

        val reason = refusal(store().read())

        assertTrue(reason.startsWith("APPLIED_STATE_INCONSISTENT"), "was: $reason")
        assertTrue(reason.contains("rollback reason"), "was: $reason")
    }

    // ------------------------------------------------------ refusal: write side

    @Test
    fun refusesToRecordAnyTransitionWithoutAGovernedApplicationBoundary() {
        // The production authoriser refuses, so nothing can be recorded as applied.
        val store = PatchStateStore(
            stateRoot = { stateRoot.absolutePath },
            engineVersion = "1.0.0",
            authenticator = approving,
            // authoriser defaults to NoGovernedPatchApplicationAuthoriser
            clock = { now },
        )

        val reason = refusal(store.persist(applyTransition()))

        assertTrue(reason.startsWith("PATCH_APPLICATION_BOUNDARY_MISSING"), "was: $reason")
        assertTrue(!recordFile.exists(), "a refused transition must write nothing at all")
    }

    // ------------------------------------------------------------ persistence

    @Test
    fun persistsAtomicallyAndLeavesNoTemporaryBehind() {
        val outcome = store().persist(applyTransition())

        assertTrue(outcome is PatchPersistOutcome.Persisted, "was: $outcome")
        assertTrue(recordFile.isFile, "the committed record must exist")
        val temp = File(recordFile.parentFile, PatchStateStore.RECORD_FILE + PatchStateStore.TMP_SUFFIX)
        assertTrue(!temp.exists(), "an atomic rename must not leave a .tmp behind")
    }

    @Test
    fun readsBackWhatItPersistedAsAnEstablishedState() {
        store().persist(applyTransition())

        val state = established(store().read())

        assertEquals(PatchSetMode.SIGNED_CURRENT, state.mode)
        assertEquals("PATCH-ADB-20261009-1", state.appliedPatches.single().patchId)
        assertEquals("a".repeat(64), state.appliedPatches.single().sha256)
        assertEquals("test-key", state.appliedPatches.single().keyId)
    }

    @Test
    fun recordsTheProvenanceRequiredByContractStepEleven() {
        store().persist(applyTransition())

        val raw = Json.parseToJsonElement(recordFile.readText(Charsets.UTF_8)) as JsonObject
        val entry = (raw["appliedPatches"] as JsonArray).first() as JsonObject
        val field = { name: String ->
            raw[name]?.toString()?.trim('"') ?: fail("record is missing '$name'")
        }
        val entryField = { name: String ->
            entry[name]?.toString()?.trim('"') ?: fail("entry is missing '$name'")
        }

        // Contract §6 step 11: applied patch_id, key_id and payload hash, plus the schema
        // version and the device scope the patch was applied against.
        assertEquals(AppliedStateRecord.RECORD_SCHEMA_VERSION, field("schemaVersion"))
        assertEquals("PATCH-ADB-20261009-1", entryField("patchId"))
        assertEquals("a".repeat(64), entryField("payloadSha256"))
        assertEquals("test-key", entryField("keyId"))
        assertEquals("1.0", entryField("envelopeSchemaVersion"))
        assertEquals("samsung/SM-A107F/api31", entryField("matchedDevice"))
    }

    @Test
    fun incrementsTheSequenceOnEveryPersist() {
        val first = store().persist(applyTransition())
        val second = store().persist(applyTransition(patchId = "PATCH-ADB-20261009-2", sha = "b".repeat(64)))

        assertEquals(1L, (first as? PatchPersistOutcome.Persisted)?.sequence)
        assertEquals(2L, (second as? PatchPersistOutcome.Persisted)?.sequence)
    }

    @Test
    fun recoversFromAnInterruptedWriteAndKeepsTheCommittedRecordAuthoritative() {
        store().persist(applyTransition())

        // A `.tmp` left behind by a write that never completed.
        val temp = File(recordFile.parentFile, PatchStateStore.RECORD_FILE + PatchStateStore.TMP_SUFFIX)
        temp.writeText("half-written garbage", Charsets.UTF_8)

        val state = established(store().read())

        assertEquals(PatchSetMode.SIGNED_CURRENT, state.mode, "the committed record still stands")
        assertTrue(!temp.exists(), "the orphaned write must be cleared, never read as state")
    }

    @Test
    fun refusesRatherThanGuessingWhenAnInterruptedWriteCannotBeCleared() {
        store().persist(applyTransition())

        // Make the orphan undeletable (a non-empty directory at the .tmp path), so the
        // store cannot silently decide which record is live.
        val temp = File(recordFile.parentFile, PatchStateStore.RECORD_FILE + PatchStateStore.TMP_SUFFIX)
        assertTrue(temp.mkdirs(), "the blocking directory could not be created")
        File(temp, "stuck.txt").writeText("x", Charsets.UTF_8)

        val reason = refusal(store().read())

        assertTrue(reason.startsWith("APPLIED_STATE_RECOVERY_FAILED"), "was: $reason")
    }

    @Test
    fun preservesThePreviouslyCommittedRecordWhenAPersistIsRefused() {
        store().persist(applyTransition())
        val before = recordFile.readText(Charsets.UTF_8)

        val refused = store(
            authoriser = PatchApplicationAuthoriser { "NOT_AUTHORISED" },
        ).persist(applyTransition(patchId = "PATCH-ADB-20261009-2", sha = "b".repeat(64)))

        assertEquals("NOT_AUTHORISED", refusal(refused))
        assertEquals(before, recordFile.readText(Charsets.UTF_8), "a refused update must not disturb the live record")
    }

    // --------------------------------------------------------------- rollback

    @Test
    fun recordsRollbackAsTheResultingAuthoritativeState() {
        store().persist(applyTransition())

        val outcome = store().persist(rollbackTransition())

        assertTrue(outcome is PatchPersistOutcome.Persisted, "was: $outcome")
        val state = established(store().read())
        assertEquals(PatchSetMode.SIGNED_ROLLED_BACK, state.mode)
        assertEquals("contract §7 rollback", state.rollbackReason)
        assertTrue(state.appliedPatches.single().rolledBackAt != null, "history is retained, never deleted")
    }

    @Test
    fun refusesARollbackWithNoReason() {
        val outcome = store().persist(rollbackTransition(reason = "   "))

        assertTrue(outcome is PatchPersistOutcome.Refused, "was: $outcome")
        assertTrue(!recordFile.exists(), "a refused transition must write nothing")
    }

    // -------------------------------------------------------------- helpers

    /** Writes a raw record so malformed-field handling can be exercised directly. */
    private fun writeRawRecord(
        sequence: Long,
        schemaVersion: String = "1.0",
        patchSetVersion: String = "NO-PATCHES",
        patchSetHash: String = PatchSetState.EMPTY_SET_HASH,
        patchSetMode: String,
        rollbackReason: String? = null,
        appliedPatches: List<String> = emptyList(),
    ) {
        recordFile.parentFile.mkdirs()
        val entries = appliedPatches.joinToString(",", prefix = "[", postfix = "]")
        val body = buildString {
            append("{")
            append("\"schemaVersion\":\"$schemaVersion\",")
            append("\"sequence\":$sequence,")
            append("\"patchSetVersion\":\"$patchSetVersion\",")
            append("\"patchSetHash\":\"$patchSetHash\",")
            append("\"patchSetMode\":\"$patchSetMode\",")
            if (rollbackReason != null) {
                append("\"rollbackReason\":\"$rollbackReason\",")
            } else {
                append("\"rollbackReason\":null,")
            }
            append("\"engineVersion\":\"1.0.0\",")
            append("\"writtenAt\":\"2026-10-09T00:00:00Z\",")
            append("\"appliedPatches\":$entries")
            append("}")
        }
        recordFile.writeText(body, Charsets.UTF_8)
    }
}
