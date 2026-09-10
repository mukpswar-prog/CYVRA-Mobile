package cyvra.mobile.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.security.MessageDigest

private val json = Json { explicitNulls = false }

fun canonicalJson(value: JsonElement): String = write(value)

fun canonicalJson(record: EvidenceRecord): String {
    val element = json.encodeToJsonElement(EvidenceRecord.serializer(), record)
    val obj = element.jsonObject.toMutableMap()
    obj.remove("digest")
    return write(JsonObject(obj))
}

fun digestCanonical(record: EvidenceRecord): String = sha256Hex(canonicalJson(record).toByteArray(Charsets.UTF_8))

fun sha256Hex(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    return digest.joinToString("") { byte -> "%02x".format(byte) }
}

private fun write(value: JsonElement): String = when (value) {
    is JsonNull -> "null"
    is JsonPrimitive -> {
        if (value.isString) json.encodeToString(JsonPrimitive.serializer(), value)
        else value.toString()
    }
    is JsonArray -> value.joinToString(",", "[", "]") { write(it) }
    is JsonObject -> {
        value.entries
            .filter { it.value !is JsonNull }
            .sortedBy { it.key }
            .joinToString(",", "{", "}") { (key, child) ->
                json.encodeToString(JsonPrimitive.serializer(), JsonPrimitive(key)) + ":" + write(child)
            }
    }
}
