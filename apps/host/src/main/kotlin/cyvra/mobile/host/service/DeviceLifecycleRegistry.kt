package cyvra.mobile.host.service

import cyvra.mobile.host.config.HostSystemProperties
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Restricted workstation-local Device Lifecycle Identity Registry (DEF-07 / Spec §24 / §9.3).
 *
 * Replaces deterministic unsalted MD5 (`UUID.nameUUIDFromBytes("cyvra:device-lifecycle:$serial")`)
 * with an opaque random UUIDv4 mapping keyed by `HMAC-SHA256(workstationSalt, normalizedSerial)`:
 * - Customer-facing reports (`report.json`, `certificate.json`, PDFs, filenames) receive only the
 *   random canonical UUIDv4 (`deviceLifecycleId`) and opaque short reference — never raw serials
 *   and never an unsalted hash from which a serial could be brute-forced.
 * - Even the restricted local state file (`<cyvra.home>/state/device-lifecycle-registry.json`)
 *   never stores plaintext serial numbers on disk.
 * - Repeated scans of the same physical device on the same workstation resolve to the exact same
 *   canonical lowercase UUIDv4 across sessions and Host restarts.
 */
object DeviceLifecycleRegistry {

    @Serializable
    private data class PersistedRegistry(
        val schemaVersion: Int = 1,
        val workstationSaltHex: String,
        val hmacToLifecycleUuid: Map<String, String> = emptyMap(),
    )

    private val json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val lock = Any()
    private val secureRandom = SecureRandom()

    // In-memory fallback used when `-Dcyvra.home` is unset (e.g., isolated JVM unit tests).
    private val ephemeralSaltBytes: ByteArray = ByteArray(32).also { secureRandom.nextBytes(it) }
    private val ephemeralMap = ConcurrentHashMap<String, String>()

    // Cached path -> loaded registry so repeated lookups stay fast and consistent.
    @Volatile
    private var cachedFilePath: String? = null
    private var cachedSaltBytes: ByteArray? = null
    private val cachedDiskMap = LinkedHashMap<String, String>()

    /**
     * Resolves (or allocates and persists) the canonical lowercase UUIDv4 `deviceLifecycleId`
     * for [serial] without exposing or persisting the raw serial number.
     */
    fun resolveOrAssign(
        serial: String,
        stateHomeOverride: String? = null,
    ): String {
        val normalized = serial.trim()
        require(normalized.isNotEmpty()) { "Device serial must not be blank when resolving deviceLifecycleId" }

        val stateHome = (stateHomeOverride ?: System.getProperty(HostSystemProperties.STATE_HOME_PROPERTY))
            ?.trim()
            ?.takeIf { it.isNotEmpty() }

        if (stateHome == null) {
            val digestKey = hmacHex(ephemeralSaltBytes, normalized)
            return ephemeralMap.computeIfAbsent(digestKey) { UUID.randomUUID().toString() }
        }

        val registryFile = File(File(stateHome, "state"), "device-lifecycle-registry.json")
        synchronized(lock) {
            ensureLoadedLocked(registryFile)
            val salt = cachedSaltBytes ?: ephemeralSaltBytes
            val digestKey = hmacHex(salt, normalized)
            val existing = cachedDiskMap[digestKey]
            if (existing != null && isCanonicalUuid(existing)) {
                return existing
            }
            val assigned = UUID.randomUUID().toString()
            cachedDiskMap[digestKey] = assigned
            persistLocked(registryFile, salt, cachedDiskMap)
            return assigned
        }
    }

    /**
     * Returns an 8-character uppercase opaque reference derived from a `deviceLifecycleId` UUID
     * suitable for customer-facing filenames and headers (`DEV-XXXXXXXX`).
     */
    fun opaqueReferenceForLifecycleId(deviceLifecycleId: String): String {
        val clean = deviceLifecycleId.trim().replace("-", "")
        val suffix = clean.take(8).uppercase().ifEmpty { "UNKNOWN0" }
        return "DEV-$suffix"
    }

    private fun ensureLoadedLocked(registryFile: File) {
        val canonicalPath = registryFile.absolutePath
        if (cachedFilePath == canonicalPath && cachedSaltBytes != null) {
            return
        }

        cachedDiskMap.clear()
        if (registryFile.isFile) {
            val parsed = runCatching {
                json.decodeFromString(PersistedRegistry.serializer(), registryFile.readText(Charsets.UTF_8))
            }.getOrNull()
            val decodedSalt = parsed?.workstationSaltHex?.let(::hexToBytesOrNull)
            if (parsed != null && decodedSalt != null && decodedSalt.size >= 16) {
                cachedSaltBytes = decodedSalt
                for ((k, v) in parsed.hmacToLifecycleUuid) {
                    if (k.isNotBlank() && isCanonicalUuid(v)) {
                        cachedDiskMap[k] = v
                    }
                }
                cachedFilePath = canonicalPath
                return
            }
        }

        val freshSalt = ByteArray(32).also { secureRandom.nextBytes(it) }
        cachedSaltBytes = freshSalt
        cachedFilePath = canonicalPath
        persistLocked(registryFile, freshSalt, cachedDiskMap)
    }

    private fun persistLocked(registryFile: File, saltBytes: ByteArray, entries: Map<String, String>) {
        runCatching {
            val parent = registryFile.parentFile
            if (parent != null && !parent.exists()) {
                parent.mkdirs()
            }
            val payload = PersistedRegistry(
                schemaVersion = 1,
                workstationSaltHex = bytesToHex(saltBytes),
                hmacToLifecycleUuid = entries.toMap(),
            )
            val tempFile = File(registryFile.parentFile, "${registryFile.name}.tmp")
            tempFile.writeText(json.encodeToString(payload), Charsets.UTF_8)
            Files.move(
                tempFile.toPath(),
                registryFile.toPath(),
                StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE,
            )
        }.onFailure {
            // Fallback non-atomic overwrite if filesystem declines ATOMIC_MOVE
            runCatching {
                val payload = PersistedRegistry(
                    schemaVersion = 1,
                    workstationSaltHex = bytesToHex(saltBytes),
                    hmacToLifecycleUuid = entries.toMap(),
                )
                registryFile.writeText(json.encodeToString(payload), Charsets.UTF_8)
            }
        }
    }

    private fun hmacHex(salt: ByteArray, message: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(salt, "HmacSHA256"))
        val digest = mac.doFinal(message.toByteArray(Charsets.UTF_8))
        return bytesToHex(digest)
    }

    private fun isCanonicalUuid(candidate: String): Boolean =
        runCatching { UUID.fromString(candidate).toString() == candidate }.getOrDefault(false)

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun hexToBytesOrNull(hex: String): ByteArray? {
        val trimmed = hex.trim()
        if (trimmed.length % 2 != 0) return null
        return runCatching {
            ByteArray(trimmed.length / 2) { idx ->
                trimmed.substring(idx * 2, idx * 2 + 2).toInt(16).toByte()
            }
        }.getOrNull()
    }
}
