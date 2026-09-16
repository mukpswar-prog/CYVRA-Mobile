package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SecurityAuditModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesSecurityAuditReport() {
        val finding = SecurityAuditFinding(
            ruleId = "SEC-001-PRIV-KEY",
            category = SecurityAuditCategory.PRIVATE_KEY_PROTECTION,
            description = "Private signing keys must remain strictly outside client workstation and repo",
            status = SecurityAuditStatus.PASSED,
            details = "Zero private keys found in client.",
            remediation = null,
        )

        val report = SecurityAuditReport(
            auditId = "AUD-SEC-001",
            workstationEnvironment = "Windows 10/11 x64 Architecture",
            findings = listOf(finding),
            totalRulesChecked = 1,
            totalPassed = 1,
            totalViolations = 0,
            isZeroLeakVerified = true,
            complianceSealDigestSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        )

        val encoded = json.encodeToString(report)
        val decoded = json.decodeFromString<SecurityAuditReport>(encoded)

        assertEquals("AUD-SEC-001", decoded.auditId)
        assertTrue(decoded.isZeroLeakVerified)
        assertEquals(SecurityAuditCategory.PRIVATE_KEY_PROTECTION, decoded.findings[0].category)
        assertEquals(SecurityAuditStatus.PASSED, decoded.findings[0].status)
    }
}
