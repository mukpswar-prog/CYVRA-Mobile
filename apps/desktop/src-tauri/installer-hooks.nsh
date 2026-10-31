/*
 * CYVRA MOBILE - NSIS installer hooks.
 *
 * Referenced by bundle.windows.nsis.installerHooks in tauri.conf.json.
 * Tauri expands these macros inside its generated installer.nsi.
 *
 * Purpose of this file:
 * 1. Stage bundled Android USB drivers (Samsung + Google WinUSB) under elevation.
 * 2. Provision `%ProgramData%\CYVRA Mobile` with safe, non-recursive inheritance ACLs
 *    after checking that the target path is NOT a reparse point / NTFS junction (DEF-18).
 * 3. On full uninstallation (excluding in-place `/UPDATE` upgrades), remove active
 *    workstation session credentials (`activation.dat` and `entitlement.json`) so a
 *    subsequent clean installation begins cleanly at `Sign in & Activate`, while
 *    preserving immutable audit logs (`logs\`) and generated customer reports (`reports\`).
 */

!macro NSIS_HOOK_POSTINSTALL

    DetailPrint "CYVRA: Android USB driver staging starting"

    IfFileExists "$SYSDIR\pnputil.exe" 0 cyvra_pnputil_absent

        IfFileExists "$INSTDIR\resources\drivers\ssudadb\*.inf" 0 cyvra_drv_ssudadb_done
            DetailPrint "CYVRA: staging Samsung ADB driver (ssudadb)"
            nsExec::ExecToLog '"$SYSDIR\pnputil.exe" /add-driver "$INSTDIR\resources\drivers\ssudadb\*.inf" /install'
            Pop $0
            DetailPrint "CYVRA: ssudadb pnputil exit code $0"
        cyvra_drv_ssudadb_done:

        IfFileExists "$INSTDIR\resources\drivers\ssudbus\*.inf" 0 cyvra_drv_ssudbus_done
            DetailPrint "CYVRA: staging Samsung USB bus driver (ssudbus)"
            nsExec::ExecToLog '"$SYSDIR\pnputil.exe" /add-driver "$INSTDIR\resources\drivers\ssudbus\*.inf" /install'
            Pop $0
            DetailPrint "CYVRA: ssudbus pnputil exit code $0"
        cyvra_drv_ssudbus_done:

        IfFileExists "$INSTDIR\resources\drivers\android_winusb\*.inf" 0 cyvra_drv_awinusb_done
            DetailPrint "CYVRA: staging Google Android WinUSB driver"
            nsExec::ExecToLog '"$SYSDIR\pnputil.exe" /add-driver "$INSTDIR\resources\drivers\android_winusb\*.inf" /install'
            Pop $0
            DetailPrint "CYVRA: android_winusb pnputil exit code $0"
        cyvra_drv_awinusb_done:

        DetailPrint "CYVRA: Android USB driver staging finished"
        GoTo cyvra_pnputil_done

    cyvra_pnputil_absent:
        DetailPrint "CYVRA: pnputil.exe not found; USB drivers not staged"

    cyvra_pnputil_done:

    /*
     * Per-machine writable state root with junction / reparse-point protection (DEF-18).
     *
     * Security hardening:
     * 1. Verify `$1` (`%ProgramData%\CYVRA Mobile`) is NOT a reparse point / junction via
     *    `fsutil.exe reparsepoint query "$1"`. `fsutil` returns exit code 0 ONLY when the
     *    target IS a reparse point; if exit code is 0, abort ACL modification immediately.
     * 2. Apply `(OI)(CI)M` on `$1` WITHOUT `/T` (no recursive traversal of child junctions).
     */
    DetailPrint "CYVRA: state root ACL starting"
    ReadEnvStr $0 ProgramData
    StrCmp $0 "" cyvra_state_no_programdata

        StrCpy $1 "$0\CYVRA Mobile"
        CreateDirectory "$1"
        DetailPrint "CYVRA: state root $1"

        IfFileExists "$SYSDIR\fsutil.exe" 0 cyvra_state_apply_acl
            nsExec::ExecToLog '"$SYSDIR\fsutil.exe" reparsepoint query "$1"'
            Pop $2
            StrCmp $2 "0" cyvra_state_reparse_detected cyvra_state_apply_acl

        cyvra_state_reparse_detected:
            DetailPrint "CYVRA: SECURITY ABORT - state root $1 is a reparse point; refusing ACL grant"
            GoTo cyvra_state_done

        cyvra_state_apply_acl:
            nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$1" /grant "*S-1-5-32-545:(OI)(CI)M" /C'
            Pop $2
            DetailPrint "CYVRA: state root icacls exit code $2"
            GoTo cyvra_state_done

    cyvra_state_no_programdata:
        DetailPrint "CYVRA: ProgramData not set; the workstation creates the state root on first run"

    cyvra_state_done:
    DetailPrint "CYVRA: state root ACL finished"

!macroend

!macro NSIS_HOOK_PREUNINSTALL

    /*
     * Clean session-credential removal on full uninstall (DEF-03 / DEF-18).
     *
     * Tauri invokes the uninstaller with `/UPDATE` (or `/P` during silent update) when
     * upgrading in place; during an in-place upgrade we preserve `activation.dat` and
     * `entitlement.json`. During a full user-initiated uninstall, we remove active
     * session tokens so reinstalling starts cleanly at `Sign in & Activate`, while
     * preserving `logs\` (ledger + audit trail) and `reports\` / `certificates\`.
     *
     * Pure NSIS substring scan over `$CMDLINE` avoids any `FileFunc.nsh` macro-insertion
     * ordering assumptions inside Tauri's generated `installer.nsi`.
     */
    StrCpy $R0 $CMDLINE
    StrLen $R1 $R0
    StrCpy $R2 0
    cyvra_uninst_scan_cmdline:
        IntCmp $R2 $R1 cyvra_uninst_not_update 0 cyvra_uninst_not_update
        StrCpy $R3 $R0 7 $R2
        StrCmp $R3 "/UPDATE" cyvra_uninst_preserve_session
        StrCpy $R3 $R0 3 $R2
        StrCmp $R3 " /P" cyvra_uninst_preserve_session
        IntOp $R2 $R2 + 1
        GoTo cyvra_uninst_scan_cmdline

    cyvra_uninst_not_update:
        ReadEnvStr $0 ProgramData
        StrCmp $0 "" cyvra_uninst_done
            StrCpy $1 "$0\CYVRA Mobile"
            IfFileExists "$1\activation.dat" 0 +3
                DetailPrint "CYVRA: clearing workstation activation session on uninstall"
                Delete "$1\activation.dat"
            IfFileExists "$1\entitlement.json" 0 +2
                Delete "$1\entitlement.json"
        GoTo cyvra_uninst_done

    cyvra_uninst_preserve_session:
        DetailPrint "CYVRA: in-place update detected; preserving active workstation licence session"

    cyvra_uninst_done:

!macroend
