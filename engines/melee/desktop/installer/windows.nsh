; Render installer and uninstaller text at the system DPI instead of bitmap scaling.
ManifestDPIAware true

; Keep the existing per-user install scope, including when setup runs as admin.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifndef BUILD_UNINSTALLER
  Var desktopShortcutCheckbox
  Var desktopShortcutChoice

  !macro customPageAfterChangeDir
    Page custom ShortcutPageCreate ShortcutPageLeave

  Function ShortcutPageCreate
    ; Silent installs and updates retain electron-builder's shortcut behavior.
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Shortcuts" "Choose shortcuts for OpenSmash Melee."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateCheckbox} 0 0 100% 12u "Create a desktop shortcut"
    Pop $desktopShortcutCheckbox
    ${If} $desktopShortcutChoice == ""
      StrCpy $desktopShortcutChoice ${BST_CHECKED}
    ${EndIf}
    ${NSD_SetState} $desktopShortcutCheckbox $desktopShortcutChoice
    nsDialogs::Show
  FunctionEnd

  Function ShortcutPageLeave
    ${NSD_GetState} $desktopShortcutCheckbox $desktopShortcutChoice
  FunctionEnd
  !macroend

  !macro customInstall
    ; Built-in shortcut handling runs first and owns uninstall cleanup. Apply
    ; an explicit wizard choice even when reinstalling over an existing copy.
    ${If} $desktopShortcutChoice == ${BST_UNCHECKED}
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${ElseIf} $desktopShortcutChoice == ${BST_CHECKED}
      ${IfNot} ${isNoDesktopShortcut}
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${EndIf}
    ${EndIf}
  !macroend
!endif
