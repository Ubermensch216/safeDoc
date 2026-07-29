@echo off
REM ============================================================
REM  safeDoc launcher
REM  Korean messages are printed by serve.ps1 (UTF-8 with BOM).
REM  This file stays ASCII-only to avoid console codepage issues.
REM ============================================================
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
if errorlevel 1 (
  echo.
  echo Failed to start. See the message above.
  pause
)
endlocal
