package cyvra.mobile.host.config

/**
 * The two roots the workstation passes to the Host JVM when it spawns it.
 *
 * They used to be one property, which is what made activation unwritable:
 * `<cyvra.home>` was the Program Files installation root, so every state write
 * (the exported entitlement, the activation store, reports, certificates) tried
 * to land in a directory the signed-in operator has no write access to. The
 * export failed, the failure was reported as a local fault with no message, and
 * the activation screen simply did not move.
 *
 * Option C (P6 task 6.2) keeps `bundle.windows.nsis.installMode` at `perMachine`
 * so `pnputil` keeps its elevation for driver staging, and separates the two
 * concerns instead of relaxing either one:
 *
 *  - [STATE_HOME_PROPERTY] is **writable** and holds state. It resolves to a
 *    machine-wide directory below `%ProgramData%`, so the licence survives a
 *    change of Windows account and an elevated installer can pre-create it with
 *    an ACL the operator can actually use.
 *  - [INSTALLATION_ROOT_PROPERTY] is **read-only** and holds the bundled
 *    binaries - platform-tools, the JRE and the Host JARs. Keeping those out of
 *    the writable root is the point: a directory any local account may write to
 *    is not where an evidence product should resolve `adb.exe` from.
 *
 * The workstation owns both values; neither is ever set by hand.
 */
object HostSystemProperties {

    /**
     * Writable per-machine state root, handed over as `-Dcyvra.home=`.
     *
     * Everything the product writes and the Host reads back lives here:
     * `entitlement.json`, `license.json`, `logs/`, `reports/` and
     * `certificates/`.
     */
    const val STATE_HOME_PROPERTY: String = "cyvra.home"

    /**
     * Read-only installation root, handed over as `-Dcyvra.install=`.
     *
     * Resolves `platform-tools\adb.exe` without depending on the process
     * working directory, which differs between `tauri dev`, a Start Menu
     * launch and a support shell.
     */
    const val INSTALLATION_ROOT_PROPERTY: String = "cyvra.install"
}
