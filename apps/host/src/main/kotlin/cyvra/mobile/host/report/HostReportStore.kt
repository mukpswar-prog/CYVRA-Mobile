package cyvra.mobile.host.report

import cyvra.mobile.host.transport.AdbBinaryLocator
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File

/**
 * Thrown when report artifacts cannot be persisted.
 *
 * The protocol layer converts this into a structured `REPORT_WRITE_FAILED` refusal so a
 * full disk or a missing installation root degrades the session instead of killing the Host.
 */
class ReportWriteException(message: String, cause: Throwable? = null) : Exception(message, cause)

/** Absolute paths and digests for one written artifact directory. */
data class WrittenArtifacts(
    val directory: File,
    val jsonPath: String,
    val markdownPath: String,
    val manifestPath: String,
    val jsonSha256: String,
    val markdownSha256: String,
)

/**
 * Persists generated reports and certificates under the installation root.
 *
 * Layout:
 * - `<cyvra.home>/reports/<reportId>/`      -> report.json, report.md, manifest.json
 * - `<cyvra.home>/certificates/<id>/`       -> certificate.json, certificate.md, manifest.json
 *
 * `manifest.json` records the SHA-256 digest of each sibling file, computed over the exact
 * UTF-8 byte sequence that is written to disk - the same content the JSON-lines response
 * carries - so the manifest describes the stored bytes rather than an in-memory stand-in.
 *
 * Resolution is fail-closed, not fatal: a missing
 * [AdbBinaryLocator.INSTALLATION_ROOT_PROPERTY] raises [ReportWriteException], which the
 * dispatcher turns into a `REPORT_WRITE_FAILED` error line. The Host keeps serving.
 *
 * Report generation itself is untouched here. This class only receives strings that have
 * already been produced and writes them out.
 */
class HostReportStore(
    private val reportEngine: HostReportEngine = HostReportEngine(),
    private val homeProvider: () -> String? = {
        System.getProperty(AdbBinaryLocator.INSTALLATION_ROOT_PROPERTY)
    },
) {

    private val manifestWriter = Json {
        prettyPrint = true
        encodeDefaults = true
    }

    fun writeReport(
        reportId: String,
        jsonContent: String,
        markdownContent: String,
    ): WrittenArtifacts = persist(
        subdirectory = REPORTS_DIRECTORY,
        artifactId = reportId,
        jsonFileName = REPORT_JSON,
        markdownFileName = REPORT_MARKDOWN,
        jsonContent = jsonContent,
        markdownContent = markdownContent,
    )

    fun writeCertificate(
        certificateId: String,
        jsonContent: String,
        markdownContent: String,
    ): WrittenArtifacts = persist(
        subdirectory = CERTIFICATES_DIRECTORY,
        artifactId = certificateId,
        jsonFileName = CERTIFICATE_JSON,
        markdownFileName = CERTIFICATE_MARKDOWN,
        jsonContent = jsonContent,
        markdownContent = markdownContent,
    )

    private fun persist(
        subdirectory: String,
        artifactId: String,
        jsonFileName: String,
        markdownFileName: String,
        jsonContent: String,
        markdownContent: String,
    ): WrittenArtifacts {
        val home = homeProvider()?.takeIf { it.isNotBlank() }
            ?: throw ReportWriteException(
                "System property '${AdbBinaryLocator.INSTALLATION_ROOT_PROPERTY}' is not set, " +
                    "so the report directory cannot be resolved.",
            )

        // Identifiers are host-generated, but a path component is still validated before it
        // is used: no traversal, no separators, nothing that could escape the home directory.
        if (!SAFE_ARTIFACT_ID.matches(artifactId)) {
            throw ReportWriteException("Refusing to write artifacts for unsafe identifier '$artifactId'.")
        }

        val directory = File(File(home, subdirectory), artifactId).absoluteFile
        val jsonFile = File(directory, jsonFileName)
        val markdownFile = File(directory, markdownFileName)
        val manifestFile = File(directory, MANIFEST_FILE_NAME)

        val jsonSha256 = reportEngine.computeSha256(jsonContent)
        val markdownSha256 = reportEngine.computeSha256(markdownContent)

        val manifest = manifestWriter.encodeToString(
            JsonElement.serializer(),
            buildJsonObject {
                put("artifactId", artifactId)
                put("algorithm", "SHA-256")
                put("jsonFile", jsonFileName)
                put("markdownFile", markdownFileName)
                put("jsonSha256", jsonSha256)
                put("markdownSha256", markdownSha256)
            },
        )

        try {
            if (!directory.isDirectory && !directory.mkdirs()) {
                throw ReportWriteException(
                    "Could not create artifact directory '${directory.absolutePath}'.",
                )
            }
            writeUtf8(jsonFile, jsonContent)
            writeUtf8(markdownFile, markdownContent)
            writeUtf8(manifestFile, manifest)
        } catch (error: ReportWriteException) {
            throw error
        } catch (error: Exception) {
            throw ReportWriteException(
                "Could not write artifacts to '${directory.absolutePath}': ${error.message}",
                error,
            )
        }

        return WrittenArtifacts(
            directory = directory,
            jsonPath = jsonFile.absolutePath,
            markdownPath = markdownFile.absolutePath,
            manifestPath = manifestFile.absolutePath,
            jsonSha256 = jsonSha256,
            markdownSha256 = markdownSha256,
        )
    }

    /** Explicit UTF-8 with no BOM, so the bytes on disk match what was hashed. */
    private fun writeUtf8(file: File, content: String) {
        file.writeText(content, Charsets.UTF_8)
    }

    companion object {
        const val REPORTS_DIRECTORY = "reports"
        const val CERTIFICATES_DIRECTORY = "certificates"
        const val REPORT_JSON = "report.json"
        const val REPORT_MARKDOWN = "report.md"
        const val CERTIFICATE_JSON = "certificate.json"
        const val CERTIFICATE_MARKDOWN = "certificate.md"
        const val MANIFEST_FILE_NAME = "manifest.json"

        /** Strict identifier shape: letters, digits, dot, underscore, hyphen. */
        private val SAFE_ARTIFACT_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]*")
    }
}
