@echo off
title Silver Print Agent - Setup
rem Double-click me. Sets up the label-printing agent on this PC (no Node.js needed).
rem Asks for the token once, then it runs forever and auto-starts on every boot.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 pause
