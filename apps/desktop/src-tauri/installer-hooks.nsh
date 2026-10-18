/*
 * CYVRA MOBILE - NSIS installer hooks.
 *
 * Referenced by bundle.windows.nsis.installerHooks in tauri.conf.json.
 * Tauri expands these macros inside its generated installer.nsi.
 *
 * Purpose of this file: make the installed product self-contained with
 * respect to Android USB drivers. A customer who plugs in a phone should
 * not have to download or install a driver by hand - the workstation
 * image already carries them.
 *
 * Why POSTINSTALL and not PREINSTALL: the driver packages are bundled
 * under $INSTDIR\resources\drivers, and PREINSTALL runs before the file
 * copy. At PREINSTALL the payloads do not exist yet.
 *
 * Why this works without a UAC prompt: bundle.windows.nsis.installMode is
 * perMachine, so the installer already runs elevated. pnputil needs that
 * elevation to write to the driver store.
 *
 * Failure policy: every step is non-fatal and logged. If a driver cannot
 * be staged the application still launches, still runs its self-test, and
 * still reports connection state honestly - it simply will not see a
 * phone until a driver is present. An installer that aborts half-way
 * through would leave the customer worse off than one that continues.
 */

!macro NSIS_HOOK_POSTINSTALL

    DetailPrint "CYVRA: Android USB driver staging starting"

    IfFileExists "$SYSDIR\pnputil.exe" 0 cyvra_pnputil_absent

        /*
         * Samsung ADB interface driver (ssudadb). This is the package that
         * binds the composite ADB function of a Samsung handset, which is
         * the interface the Host's adb transport talks to.
         */
        IfFileExists "$INSTDIR\resources\drivers\ssudadb\*.inf" 0 cyvra_drv_ssudadb_done
            DetailPrint "CYVRA: staging Samsung ADB driver (ssudadb)"
            nsExec::ExecToLog '"$SYSDIR\pnputil.exe" /add-driver "$INSTDIR\resources\drivers\ssudadb\*.inf" /install'
            Pop $0
            /*
             * 0   = staged and bound
             * 259 = the package is already in the store (ERROR_NO_MORE_ITEMS),
             *       which is the desired end state on a repair install.
             * Anything else is reported and skipped over.
             */
            DetailPrint "CYVRA: ssudadb pnputil exit code $0"
        cyvra_drv_ssudadb_done:

        /*
         * Samsung USB bus driver (ssudbus). Present so the composite device
         * enumerates cleanly before the ADB function is bound.
         */
        IfFileExists "$INSTDIR\resources\drivers\ssudbus\*.inf" 0 cyvra_drv_ssudbus_done
            DetailPrint "CYVRA: staging Samsung USB bus driver (ssudbus)"
            nsExec::ExecToLog '"$SYSDIR\pnputil.exe" /add-driver "$INSTDIR\resources\drivers\ssudbus\*.inf" /install'
            Pop $0
            DetailPrint "CYVRA: ssudbus pnputil exit code $0"
        cyvra_drv_ssudbus_done:

        /*
         * Google generic Android WinUSB driver (android_winusb). Covers
         * Pixel and other AOSP-reference devices that do not ship an OEM
         * driver of their own.
         */
        IfFileExists "$INSTDIR\resources\drivers\android_winusb\*.inf" 0 cyvra_drv_awinusb_done
            DetailPrint "CYVRA: staging Google Android WinUSB driver"
            nsExec::ExecToLog '"$SYSDIR\pnputil.exe" /add-driver "$INSTDIR\resources\drivers\android_winusb\*.inf" /install'
            Pop $0
            DetailPrint "CYVRA: android_winusb pnputil exit code $0"
        cyvra_drv_awinusb_done:

        DetailPrint "CYVRA: Android USB driver staging finished"
        GoTo cyvra_pnputil_done

    cyvra_pnputil_absent:
        /*
         * Not expected on Windows 10 or 11. Recorded rather than assumed,
         * because a silent skip here would look identical to a success in
         * the install log.
         */
        DetailPrint "CYVRA: pnputil.exe not found; USB drivers not staged"

    cyvra_pnputil_done:

    /*
     * Per-machine writable state root (Option C, P6 task 6.2).
     *
     * Activation writes entitlement.json, license.json, logs/, reports/ and
     * certificates/ into <ProgramData>\CYVRA Mobile - never into $INSTDIR.
     * Under perMachine $INSTDIR is Program Files, which is read-only for the
     * operator running the app, and that was the defect: the export failed,
     * the failure rendered as a local fault carrying no message, and ACTIVATE
     * simply did not move to the next screen.
     *
     * installMode stays perMachine so the pnputil staging above keeps the
     * elevation it needs. Only this data directory's ACL changes.
     *
     * The grant is (OI)(CI)M on the state directory alone and is deliberately
     * not applied to $INSTDIR: bundled adb.exe, the JRE and the Host JARs stay
     * read-only for every non-elevated account, because an evidence product
     * must not resolve its tooling from a directory any local user can rewrite.
     *
     * Non-fatal, like every other step in this hook. If the grant fails the
     * install still completes, and the workstation - which creates this
     * directory itself on first run - still works for the account that
     * created it. The exit code is printed so a failure cannot be mistaken
     * for a granted ACL when the log is read later.
     */
    DetailPrint "CYVRA: state root ACL starting"
    ReadEnvStr $0 ProgramData
    StrCmp $0 "" cyvra_state_no_programdata

        StrCpy $1 "$0\CYVRA Mobile"
        CreateDirectory "$1"
        DetailPrint "CYVRA: state root $1"
        nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$1" /grant "*S-1-5-32-545:(OI)(CI)M" /T /C'
        Pop $2
        DetailPrint "CYVRA: state root icacls exit code $2"
        GoTo cyvra_state_done

    cyvra_state_no_programdata:
        /*
         * Not expected on Windows 10 or 11. Recorded rather than assumed,
         * for the same reason pnputil's absence is: a silent skip in the
         * install log is indistinguishable from a granted ACL.
         */
        DetailPrint "CYVRA: ProgramData not set; the workstation creates the state root on first run"

    cyvra_state_done:

    DetailPrint "CYVRA: state root ACL finished"

!macroend
