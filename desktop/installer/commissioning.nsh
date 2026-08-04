; PETC Desktop cloud commissioning is deliberately an external file, not an
; electron-builder resource. Preserve it only across an NSIS update, then
; restore it beside PETC Desktop.exe. An explicit uninstall removes the key.
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"

; BUILD_UNINSTALLER includes this file too. The page callbacks belong only to
; the installer; customUnInit below remains available to the uninstaller.
!ifndef BUILD_UNINSTALLER
Var PetcCommissionDialog
Var PetcCloudUrlField
Var PetcCloudKeyField
Var PetcCenterField
Var PetcLaneField
Var PetcCloudUrl
Var PetcCloudKey
Var PetcExpectedCenter
Var PetcExpectedLane

; electron-builder's NSIS template invokes this hook after installation
; directory selection, while the installer is elevated for per-machine setup.
!macro customPageAfterChangeDir
  Page custom PetcCommissioningCreate PetcCommissioningLeave
!macroend

Function PetcCommissioningCreate
  ${GetOptions} "$CMDLINE" "--updated" $0
  StrCmp $0 "" +2
    Abort
  nsDialogs::Create 1018
  Pop $PetcCommissionDialog
  ${If} $PetcCommissionDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 28u "Optional cloud commissioning (recommended now; required before testing)."
  Pop $0
  ${NSD_CreateLabel} 0 32u 100% 10u "Cloud URL"
  Pop $0
  ${NSD_CreateText} 0 44u 100% 12u ""
  Pop $PetcCloudUrlField
  ${NSD_CreateLabel} 0 60u 100% 10u "Issued lane key"
  Pop $0
  ${NSD_CreatePassword} 0 72u 100% 12u ""
  Pop $PetcCloudKeyField
  ${NSD_CreateLabel} 0 88u 48% 10u "Expected center ID"
  Pop $0
  ${NSD_CreateText} 0 100u 48% 12u ""
  Pop $PetcCenterField
  ${NSD_CreateLabel} 52% 88u 48% 10u "Expected lane number"
  Pop $0
  ${NSD_CreateText} 52% 100u 48% 12u ""
  Pop $PetcLaneField
  nsDialogs::Show
FunctionEnd

Function PetcCommissioningLeave
  ${NSD_GetText} $PetcCloudUrlField $PetcCloudUrl
  ${NSD_GetText} $PetcCloudKeyField $PetcCloudKey
  ${NSD_GetText} $PetcCenterField $PetcExpectedCenter
  ${NSD_GetText} $PetcLaneField $PetcExpectedLane
  ; All blank is intentional: the first-run Electron wizard can validate the
  ; connection. A partly-entered identity is never written.
  StrCmp $PetcCloudUrl "" petc_commission_empty petc_commission_check
petc_commission_empty:
  StrCmp $PetcCloudKey "" 0 petc_commission_incomplete
  StrCmp $PetcExpectedCenter "" 0 petc_commission_incomplete
  StrCmp $PetcExpectedLane "" 0 petc_commission_incomplete
  Return
petc_commission_check:
  StrCmp $PetcCloudKey "" petc_commission_incomplete
  StrCmp $PetcExpectedCenter "" petc_commission_incomplete
  StrCmp $PetcExpectedLane "" petc_commission_incomplete
  Return
petc_commission_incomplete:
  MessageBox MB_ICONSTOP "Enter all cloud commissioning fields or leave all fields blank to complete commissioning on first run."
  Abort
FunctionEnd
!endif

; Runs before electron-builder's generated uninstaller executes RMDir /r
; $INSTDIR. customUnInstall is too late for this backup.
!macro customUnInit
  ${GetOptions} "$CMDLINE" "--updated" $0
  StrCmp $0 "" petc_config_backup_done
  IfFileExists "$INSTDIR\petc.properties" 0 petc_config_backup_done
  CreateDirectory "$APPDATA\PETC Desktop"
  CopyFiles /SILENT "$INSTDIR\petc.properties" "$APPDATA\PETC Desktop\petc.properties.upgrade"
petc_config_backup_done:
!macroend

!macro customInstall
  IfFileExists "$APPDATA\PETC Desktop\petc.properties.upgrade" 0 petc_config_restore_done
  CopyFiles /SILENT "$APPDATA\PETC Desktop\petc.properties.upgrade" "$INSTDIR\petc.properties"
  Delete "$APPDATA\PETC Desktop\petc.properties.upgrade"
petc_config_restore_done:
  ; Write directly while NSIS has administrator rights. Do not echo/log any
  ; field, particularly the issued lane key.
  StrCmp $PetcCloudUrl "" petc_config_write_done
  FileOpen $0 "$INSTDIR\petc.properties" w
  FileWrite $0 "petc.profile=production$\r$\n"
  FileWrite $0 "petc.cloud.url=$PetcCloudUrl$\r$\n"
  FileWrite $0 "petc.cloud.key=$PetcCloudKey$\r$\n"
  FileWrite $0 "petc.expected.center=$PetcExpectedCenter$\r$\n"
  FileWrite $0 "petc.expected.lane=$PetcExpectedLane$\r$\n"
  FileClose $0
petc_config_write_done:
!macroend
