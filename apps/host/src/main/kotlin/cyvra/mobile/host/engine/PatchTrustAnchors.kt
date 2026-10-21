package cyvra.mobile.host.engine

/**
 * The governed build-time trust-anchor registry required by contract 3.
 *
 * > "Public keys are compiled into the engine at governed build time. Unknown `key_id`
 * > MUST be rejected. There is **no network key fetch inside the actuation path**."
 *
 * ## This registry is empty by design, and must stay empty until a real key exists
 *
 * [ALL] contains **no** public keys. That is not a placeholder to be filled in later by
 * whoever next edits this file — it is the current, correct state of the product:
 *
 *  - **Key custody (contract §9.1) is now DECIDED**: the Chief Engineer has named **the
 *    security owner** as the Ed25519 private-key custodian. That settles *who* holds the
 *    key.
 *  - **No key has been issued yet.** The custodian has not generated and delivered a key
 *    pair, so no public key and no `key_id` exist to place here. Custody being decided
 *    does not authorise inventing one.
 *
 * Because verification is fail-closed, an empty registry is a safe state: every envelope
 * fails contract 6 step 3 with `PATCH_UNKNOWN_KEY`, so
 * [FileBasedPatchStateProvider] refuses to establish a patch state and [cyvra.mobile.host
 * .protocol.HostProtocolDispatcher] refuses to finalise a report. Nothing degrades to
 * "assume no patches" — an interface existing is not authority.
 *
 * ## What MUST NOT be placed here
 *
 * A generated, illustrative, fixture, test, demo or "temporary" key. Such a key would let
 * whoever generated its private half authoritatively assert the applied patch set of a
 * customer's device, which is exactly the claim a controlled report exists to evidence.
 * `FileBasedPatchStateProviderTest` pins [ALL]'s emptiness so this cannot regress silently.
 *
 * ## The exact point of configuration (contract §3 + §9.1)
 *
 * Custody is settled (the security owner). The single remaining precondition is
 * receiving that custodian's first approved public key and `key_id`. When it arrives, the
 * single point of configuration is the map literal below. No other file, resource,
 * environment variable, command-line switch, downloaded file or network response may
 * introduce a trust anchor.
 *
 * **Pending key-lifecycle policy** (needs the security owner's ruling): the retirement
 * cadence for rotated keys and the approval ledger that records each `key_id`.
 *
 * ```kotlin
 * val ALL: Map<String, TrustAnchor> = mapOf(
 *     "<APPROVED-KEY-ID>" to TrustAnchor(
 *         keyId = "<APPROVED-KEY-ID>",
 *         publicKeyBase64 = "<base64 SPKI from the named custodian>",
 *     ),
 *     // Contract 3 key rotation: a retired key is retained for verifying historical
 *     // reports and MUST be flagged so it can never authorise a new patch.
 *     // "<RETIRED-KEY-ID>" to TrustAnchor(
 *     //     keyId = "<RETIRED-KEY-ID>",
 *     //     publicKeyBase64 = "<base64 SPKI from the named custodian>",
 *     //     trustedForVerifyOnly = true,
 *     // ),
 * )
 * ```
 *
 * The private key itself MUST NOT exist in this repository, in any patch file, in
 * telemetry, or in a report (contract 3).
 */
object PatchTrustAnchors {

    /** Public keys trusted to authorise a patch, keyed by `key_id`. Empty today. */
    val ALL: Map<String, TrustAnchor> = emptyMap()
}
