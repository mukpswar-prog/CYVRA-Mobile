package cyvra.mobile.core

/**
 * Offline-first sync queue (guideline §8.2).
 * `collectedAt` on each record is never replaced with [syncedAt].
 */
class OfflineQueue {
    private val items = LinkedHashMap<String, QueuedItem>()

    fun enqueue(record: EvidenceRecord, queuedAt: String): QueuedItem {
        val issues = assertS1Honesty(record)
        require(issues.isEmpty()) { issues.joinToString { it.reason } }
        val item = QueuedItem(record = record, queuedAt = queuedAt, syncedAt = null)
        items[record.evidenceId] = item
        return item
    }

    fun pending(): List<QueuedItem> = items.values.filter { it.syncedAt == null }

    fun markSynced(evidenceId: String, syncedAt: String): EvidenceRecord {
        val current = checkNotNull(items[evidenceId]) { "unknown evidence $evidenceId" }
        val updated = current.copy(syncedAt = syncedAt)
        items[evidenceId] = updated
        return updated.record
    }

    fun toBatch(
        batchId: String,
        createdAt: String,
    ): EvidenceBatch {
        val records = pending().map { it.record }
        check(records.isNotEmpty()) { "no pending evidence" }
        val first = records.first()
        return EvidenceBatch(
            batchId = batchId,
            deviceLifecycleId = first.deviceLifecycleId,
            processingSessionId = first.processingSessionId,
            records = records,
            createdAt = createdAt,
        )
    }
}
