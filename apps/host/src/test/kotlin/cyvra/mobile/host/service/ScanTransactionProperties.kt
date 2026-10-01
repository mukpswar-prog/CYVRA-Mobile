package cyvra.mobile.host.service

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.core.ScanCommitStatus
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import net.jqwik.api.ForAll
import net.jqwik.api.Property
import net.jqwik.api.constraints.IntRange

/**
 * Property-based proof of the §14 transaction rules.
 *
 * The hand-written tests in this package each demonstrate one correct path.
 * These fuzz *sequences* of paths, because the bug §14 exists to prevent is not
 * a wrong answer to a single question - it is the sum of an arbitrary number of
 * individually-reasonable ones: a reservation here, a retry there, a scan that
 * failed halfway, a certificate fetched twice because the first answer looked
 * like it had not arrived. No fixed example list reaches the corners those
 * sequences do, which is why the two invariants are stated as properties over
 * everything rather than asserted over a few.
 *
 * Two claims are being proved:
 *
 *  1. **A certificate is the only thing that can spend a scan.** The balance
 *     moves exactly once per certificate generated and never otherwise, and it
 *     is never moved twice for the same session.
 *  2. **Concurrent fetches of one certificate charge exactly once.**
 *
 * The state under test is the real [HostLicenseService], not a model of it: a
 * property proved against a reimplementation would only be a property of the
 * reimplementation. Clocks are irrelevant here because the debit carries no
 * timestamp - ordering comes from the transaction status alone.
 */
class ScanTransactionProperties {

    private fun freshLicense(entitlement: Int = 25) = CustomerLicenseRecord(
        licenseId = "LIC-PROP-001",
        serialNumber = "CYVRA15092026SA3F1-1-25",
        customerEmail = "test@customer.com",
        customerName = "Ramesh Kumar",
        companyName = "Kumar Refurbishing",
        planName = "$entitlement Device Scans",
        deviceScanEntitlement = entitlement,
        scansUsed = 0,
        scansRemaining = entitlement,
        revision = 1,
        status = LicenseEntitlementStatus.ACTIVE,
    )

    // ------------------------------------------------------------------
    // 1. A certificate is the only thing that can spend a scan
    // ------------------------------------------------------------------

    @Property(tries = 500)
    fun theBalanceMovesExactlyOncePerCertificateAndNeverOtherwise(
        @ForAll seed: Int,
        @ForAll @IntRange(min = 0, max = 40) length: Int,
    ) {
        val service = HostLicenseService(freshLicense())
        val random = Random(seed)

        val pending = ArrayDeque<String>()
        val certificates = mutableSetOf<String>()
        var reserved = 0

        repeat(length) {
            when (random.nextInt(6)) {
                0 -> {
                    // RUN_SCAN: a reservation. The balance must not move. Whether a
                    // reservation is available is settled by the service's own rule -
                    // outstanding holds, not merely the balance - and this fuzzer
                    // reads that rule back rather than duplicating a guess at it.
                    val unsettled = service.allTransactions()
                        .count { tx -> tx.status == ScanCommitStatus.COMMITTED }
                    if (service.getLicense().scansRemaining > unsettled) {
                        val session = "SESSION-${reserved++}"
                        service.commitScanForSession(session, "DEVICE")
                        pending.addLast(session)
                    }
                }

                1 -> {
                    // GET_FINAL_REPORT: a certificate is written, so the one
                    // reserved scan behind it is spent - and spent exactly once.
                    if (pending.isNotEmpty()) {
                        val session = pending.removeFirst()
                        assertTrue(
                            service.debitForSession(session),
                            "a reserved session whose certificate exists must settle",
                        )
                        certificates += session
                    }
                }

                2 -> {
                    // The scan failed or the operator walked away: no report, so
                    // nothing may be taken and the reservation is released.
                    if (pending.isNotEmpty()) service.abandonScan(pending.removeFirst())
                }

                3 -> {
                    // GET_FINAL_REPORT replayed for a certificate already issued.
                    if (certificates.isNotEmpty()) {
                        val session = certificates.random(random)
                        assertTrue(
                            !service.debitForSession(session),
                            "a replayed certificate must never charge again",
                        )
                    }
                }

                4 -> {
                    // A certificate attributed to a session that never reserved.
                    assertTrue(
                        !service.debitForSession("GHOST-${seed}-$it"),
                        "nothing reserved, so nothing may be spent",
                    )
                }

                else -> {
                    // A pure read: the balance must be exactly where it was.
                }
            }

            val record = service.getLicense()

            // Invariants that must hold after *every* step, not merely at the end -
            // a violation seen midway and later papered over is still a violation.
            assertEquals(
                record.deviceScanEntitlement,
                record.scansUsed + record.scansRemaining,
                "used + remaining must always equal the entitlement",
            )
            assertTrue(record.scansRemaining >= 0, "the balance never goes negative")
            assertTrue(record.scansUsed <= record.deviceScanEntitlement, "never past entitlement")

            // The whole point: the balance moved once per certificate, and for no
            // other reason. Every RUN_SCAN, every failure, every replay and every
            // ghost in this sequence contributed exactly nothing.
            assertEquals(
                certificates.size,
                record.scansUsed,
                "only a certificate may move the balance",
            )
            assertEquals(
                certificates.size,
                service.allTransactions().count { it.status == ScanCommitStatus.VERIFIED_AND_DEBITED },
                "the transaction journal must agree with the balance",
            )
        }
    }

    @Property(tries = 300)
    fun aSequenceOfFailedScansNeverTouchesTheBalance(
        @ForAll seed: Int,
        @ForAll @IntRange(min = 1, max = 30) rounds: Int,
    ) {
        val service = HostLicenseService(freshLicense())
        val random = Random(seed)

        repeat(rounds) {
            val unsettled = service.allTransactions()
                .count { tx -> tx.status == ScanCommitStatus.COMMITTED }
            if (service.getLicense().scansRemaining <= unsettled) return@repeat

            val session = "FAILED-$seed-$it"
            service.commitScanForSession(session, "DEVICE")
            // Alternate between the two ways a scan ends without a certificate:
            // an explicit abandonment, and simply never asking for one.
            if (random.nextBoolean()) service.abandonScan(session)
        }

        val record = service.getLicense()
        assertEquals(0, record.scansUsed, "no certificate was generated, so nothing was spent")
        assertEquals(record.deviceScanEntitlement, record.scansRemaining)
        assertTrue(
            service.allTransactions().none { it.status == ScanCommitStatus.VERIFIED_AND_DEBITED },
            "not one transaction may be settled",
        )
    }

    // ------------------------------------------------------------------
    // 2. Never debited twice, even when several callers race for one certificate
    // ------------------------------------------------------------------

    @Property(tries = 60)
    fun concurrentFetchesOfOneCertificateChargeExactlyOnce(
        @ForAll @IntRange(min = 2, max = 16) callers: Int,
    ) {
        val service = HostLicenseService(freshLicense())
        service.commitScanForSession("SESSION-RACE", "DEVICE")

        val arrived = CountDownLatch(callers)
        val start = CountDownLatch(1)
        val performed = AtomicInteger(0)
        val pool = Executors.newFixedThreadPool(callers)

        try {
            repeat(callers) {
                pool.execute {
                    arrived.countDown()
                    start.await()
                    if (service.debitForSession("SESSION-RACE")) performed.incrementAndGet()
                }
            }

            // Every worker is parked at the gate before any of them may move, so
            // this is a genuine race on the same session rather than a schedule
            // where the first call happens to finish before the second begins.
            assertTrue(arrived.await(5, TimeUnit.SECONDS), "workers must reach the gate")
            start.countDown()
        } finally {
            pool.shutdown()
            assertTrue(pool.awaitTermination(20, TimeUnit.SECONDS), "workers must finish")
        }

        assertEquals(1, performed.get(), "exactly one caller may perform the debit")
        assertEquals(1, service.getLicense().scansUsed)
        assertEquals(24, service.getLicense().scansRemaining)
        assertEquals(
            ScanCommitStatus.VERIFIED_AND_DEBITED,
            service.transactionFor("SESSION-RACE")?.status,
            "the journal must hold one settled transaction, not many",
        )
    }

    @Property(tries = 60)
    fun concurrentReservationsNeverOvercommitTheEntitlement(
        @ForAll @IntRange(min = 2, max = 12) callers: Int,
    ) {
        // A deliberately small entitlement so the contention actually runs out of
        // room: against the full 25 this property could pass without a single
        // refusal ever being exercised.
        val entitlement = 3
        val service = HostLicenseService(freshLicense(entitlement))
        val arrived = CountDownLatch(callers)
        val start = CountDownLatch(1)
        val committed = AtomicInteger(0)
        val refused = AtomicInteger(0)
        val pool = Executors.newFixedThreadPool(callers)

        try {
            repeat(callers) {
                pool.execute {
                    arrived.countDown()
                    start.await()
                    try {
                        service.commitScanForSession("RACE-$it", "DEVICE")
                        committed.incrementAndGet()
                    } catch (expected: IllegalStateException) {
                        refused.incrementAndGet()
                    }
                }
            }
            assertTrue(arrived.await(5, TimeUnit.SECONDS), "workers must reach the gate")
            start.countDown()
        } finally {
            pool.shutdown()
            assertTrue(pool.awaitTermination(20, TimeUnit.SECONDS), "workers must finish")
        }

        assertEquals(callers, committed.get() + refused.get(), "every worker reached a decision")
        assertTrue(
            committed.get() <= entitlement,
            "no more reservations than the entitlement allows may be held at once",
        )

        val record = service.getLicense()
        assertEquals(
            record.deviceScanEntitlement,
            record.scansUsed + record.scansRemaining,
            "used + remaining must still equal the entitlement",
        )
        assertTrue(
            service.allTransactions().count { it.status == ScanCommitStatus.COMMITTED } <=
                record.scansRemaining,
            "outstanding reservations must never exceed what is left to give",
        )
    }
}
