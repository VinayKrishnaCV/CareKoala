; OCR (torch) and the local model (llama.cpp) need the Microsoft Visual C++
; 2015-2022 runtime 14.44 or newer. Most PCs already have it; only install the
; bundled, Microsoft-signed redistributable when it is missing or older.
!macro customInstall
  StrCpy $R0 0
  SetRegView 64
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Minor"
  ${If} $0 == 1
  ${AndIf} $1 >= 44
    StrCpy $R0 1
  ${EndIf}
  SetRegView 32
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Minor"
  ${If} $0 == 1
  ${AndIf} $1 >= 44
    StrCpy $R0 1
  ${EndIf}
  ${If} $R0 != 1
    DetailPrint "Installing the Microsoft Visual C++ runtime that CareKoala needs..."
    ExecWait '"$INSTDIR\resources\engine\redist\vc_redist.x64.exe" /install /quiet /norestart' $2
    DetailPrint "Microsoft Visual C++ runtime setup finished (code $2)."
  ${EndIf}
!macroend
