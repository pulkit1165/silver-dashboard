@echo off
setlocal enabledelayedexpansion
title Silver Print Agent - Installer

set "DIR=%LOCALAPPDATA%\SilverPrintAgent"
set "PS=%DIR%\SilverPrintAgent.ps1"

echo(
echo   Silver ERP - Print Agent installer
echo   ==================================
echo(

if not exist "%~dp0SilverPrintAgent.ps1" (
  echo   [!] SilverPrintAgent.ps1 must be in the SAME folder as this file.
  echo       Extract the whole zip together, then run this again.
  pause & exit /b 1
)

rem --- copy the agent into a permanent per-user folder ------------------------
if not exist "%DIR%" mkdir "%DIR%"
copy /Y "%~dp0SilverPrintAgent.ps1" "%PS%" >nul

rem --- token -----------------------------------------------------------------
set "TOKEN="
set /p "TOKEN=  Paste the PRINT_AGENT_TOKEN and press Enter: "
if "%TOKEN%"=="" ( echo   [!] No token entered. Aborting. & pause & exit /b 1 )

rem write config.json via PowerShell (avoids batch quoting problems)
powershell -NoProfile -Command "$t='%TOKEN%'.Trim(); @{ token = $t } | ConvertTo-Json | Set-Content -Encoding ASCII -Path '%DIR%\config.json'"
echo   Saved config.

rem --- auto-start: Scheduled Task at logon (fallback to Run key) --------------
set "LAUNCH=powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%PS%\""
schtasks /Create /TN "SilverPrintAgent" /TR "%LAUNCH%" /SC ONLOGON /RL LIMITED /F >nul 2>&1
if errorlevel 1 (
  reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v SilverPrintAgent /t REG_SZ /d "%LAUNCH%" /f >nul
  echo   Auto-start: Run key.
) else (
  echo   Auto-start: Scheduled Task at logon.
)

rem --- start it right now (hidden) --------------------------------------------
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%PS%"

echo(
echo   Done. The agent is running now and will auto-start every login.
echo   Open the ERP - Print Queue page: this PC should show ONLINE in ~30 seconds.
echo(
echo   If it does not, open this log and send it to Pulkit:
echo     %DIR%\agent.log
echo(
pause
