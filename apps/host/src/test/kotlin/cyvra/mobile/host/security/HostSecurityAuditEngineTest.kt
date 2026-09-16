package cyvra.mobile.host.security

import cyvra.mobile.core.SecurityAuditCategory
import cyvra.mobile.core.SecurityAuditStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HostSecurityAuditEngineTest {

    private val engine = HostSecurityAuditEngine()

    @Test
    fun passesFullAuditInCleanEnvironment() {
        val report = engine.runFullSecurityAudit(
            clientConfigDump = "safe_clean_configuration_without_secrets",
            installedSigningKeyId = null,
            paymentGatewaySecretsPresent = false,
            adminCredentialsPresent = false,
        )

        assertTrue(report.isZeroLeakVerified)
        assertEquals(0, report.totalViolations)
        assertEquals(7, report.totalRulesChecked)
        assertEquals(7, report.totalPassed)
        assertTrue(report.complianceSealDigestSha256.isNotEmpty())
    }

    @Test
    fun detectsAndFailsWhenPrivateKeyFoundInConfig() {
        val leakyConfig = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y..."

        val report = engine.runFullSecurityAudit(
            clientConfigDump = leakyConfig,
        )

        assertFalse(report.isZeroLeakVerified)
        assertEquals(1, report.totalViolations)

        val failedFinding = report.findings.first { it.status == SecurityAuditStatus.FAILED }
        assertEquals(SecurityAuditCategory.PRIVATE_KEY_PROTECTION, failedFinding.category)
        assertEquals("SEC-001-PRIV-KEY", failedFinding.ruleId)
    }

    @Test
    fun detectsAndFailsWhenPaymentSecretPresent() {
        val leakyConfig = "gateway_key: rzp_live_904128abcdef01"

        val report = engine.runFullSecurityAudit(
            clientConfigDump = leakyConfig,
        )

        assertFalse(report.isZeroLeakVerified)
        val payFinding = report.findings.first { it.category == SecurityAuditCategory.PAYMENT_SECRET_ISOLATION }
        assertEquals(SecurityAuditStatus.FAILED, payFinding.status)
    }

    @Test
    fun validatesAdbCommandSafetyAndRejectsDangerousInjection() {
        // Safe commands
        assertTrue(engine.validateAdbCommandSafety("getprop ro.product.model"))
        assertTrue(engine.validateAdbCommandSafety("dumpsys battery"))
        assertTrue(engine.validateAdbCommandSafety("cat /proc/meminfo"))
        assertTrue(engine.validateAdbCommandSafety("df /data"))

        // Malicious or dangerous commands
        assertFalse(engine.validateAdbCommandSafety("getprop; rm -rf /data"))
        assertFalse(engine.validateAdbCommandSafety("getprop | grep sensitive"))
        assertFalse(engine.validateAdbCommandSafety("cat /proc/meminfo && reboot"))
        assertFalse(engine.validateAdbCommandSafety("`reboot`"))
        assertFalse(engine.validateAdbCommandSafety("$(whoami)"))
        assertFalse(engine.validateAdbCommandSafety("su -c id"))
    }
}
