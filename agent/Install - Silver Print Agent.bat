@echo off
title Silver Print Agent - Setup
rem Double-click me. Runs the PowerShell agent (no Node.js needed). First run asks
rem for the token, installs itself, and sets it to auto-start. Windows has PowerShell
rem built in, so there is nothing else to download.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0SilverPrintAgent.ps1"
