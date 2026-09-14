@echo off
title Update Silver Print Agent (faster printing)
echo(
echo   Updating the Silver print agent on this PC...
echo   (this makes the printer start within a second instead of waiting 3-4s)
echo(
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; $dir='C:\Users\Public\SilverPrintAgent'; if(!(Test-Path $dir)){New-Item -ItemType Directory -Force -Path $dir ^| Out-Null}; Invoke-WebRequest 'https://silver-dashboard-eight.vercel.app/agent/SilverPrintAgent.ps1' -OutFile (Join-Path $dir 'SilverPrintAgent.ps1') -UseBasicParsing; schtasks /End /TN SilverPrintAgent 2>$null; Start-Sleep -Seconds 1; schtasks /Run /TN SilverPrintAgent 2>$null; Write-Host '  Updated OK.' -ForegroundColor Green" || echo   Update FAILED - check internet, then try again.
echo(
echo   Done. Print a test label - it should come out almost immediately.
echo   You can close this window.
echo(
pause
