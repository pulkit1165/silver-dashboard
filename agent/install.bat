@echo off
setlocal enabledelayedexpansion
title Silver Print Agent - Installer

rem ============================================================================
rem  Silver ERP print agent installer.
rem  Put this file in the agent folder (next to print-agent.mjs & rawprint.ps1).
rem  If the PC has no Node.js, drop a portable Node into a "node" subfolder so
rem  that node\node.exe sits beside this file. Then just double-click this .bat.
rem ============================================================================

set "BASEURL=https://silver-dashboard-eight.vercel.app"
set "DIR=%~dp0"

echo(
echo   Silver ERP - Print Agent installer
echo   ----------------------------------
echo(

rem --- find Node.js -----------------------------------------------------------
set "NODE="
if exist "%DIR%node\node.exe" set "NODE=%DIR%node\node.exe"
if not defined NODE for /f "delims=" %%i in ('where node 2^>nul') do set "NODE=%%i"
if not defined NODE (
  echo   [!] Node.js not found.
  echo       Put a portable Node in a "node" subfolder ^(so node\node.exe is next to this file^),
  echo       or install Node.js from nodejs.org, then run this again.
  echo(
  pause & exit /b 1
)
echo   Node: %NODE%

rem --- token ------------------------------------------------------------------
echo(
set "TOKEN="
set /p "TOKEN=  Paste the PRINT_AGENT_TOKEN and press Enter: "
if not defined TOKEN ( echo   [!] No token entered. Aborting. & pause & exit /b 1 )

rem --- write config.json ------------------------------------------------------
> "%DIR%config.json" echo {"baseUrl":"%BASEURL%","token":"%TOKEN%","printerFilter":"TSC","pollMs":2500,"heartbeatMs":30000}
echo   Wrote config.json

rem --- register auto-start (per-user, no admin needed) ------------------------
set "RUNCMD=powershell -WindowStyle Hidden -Command ""& '%NODE%' '%DIR%print-agent.mjs'"""
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v SilverPrintAgent /t REG_SZ /d "%RUNCMD%" /f >nul
echo   Registered auto-start on login

rem --- launch now -------------------------------------------------------------
echo(
echo   Starting the agent...
start "" /min "%NODE%" "%DIR%print-agent.mjs"

echo(
echo   Done. In the ERP -> Print Barcode Labels page, switch the print engine to
echo   "Direct (our bridge)" and this PC's TSC printer will appear. Print a test label.
echo(
pause
