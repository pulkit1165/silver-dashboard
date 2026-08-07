param([string]$Token = "")

# ============================================================================
#  Silver ERP - Print Agent installer (robust). Run by "Install - Silver Print
#  Agent.bat". Installs to a visible folder, registers a self-healing Scheduled
#  Task (starts on boot/login, restarts if it ever stops), makes a Desktop
#  shortcut, and starts printing. Built to run 24/7 for lakhs of prints a month.
# ============================================================================

$ErrorActionPreference = "Stop"
$InstallDir = "C:\Users\Public\SilverPrintAgent"
$AgentPath  = Join-Path $InstallDir "SilverPrintAgent.ps1"
$Src        = Split-Path -Parent $PSCommandPath

Write-Host ""
Write-Host "  Silver ERP - Print Agent" -ForegroundColor Green
Write-Host "  ========================"
Write-Host ""

# --- files ------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $Src "SilverPrintAgent.ps1") -Destination $AgentPath -Force

# --- token ------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($Token)) { $Token = Read-Host "  Paste the print token and press Enter" }
$Token = ("" + $Token).Trim()
if ([string]::IsNullOrWhiteSpace($Token)) { Write-Host "  No token entered. Aborting." -ForegroundColor Red; Start-Sleep 5; exit 1 }
@{ token = $Token } | ConvertTo-Json | Set-Content -Encoding ASCII -Path (Join-Path $InstallDir "config.json")
Write-Host "  Saved token."

# --- a big obvious README + a restart shortcut ------------------------------
@"
===========================================================
  SILVER PRINT AGENT   -   DO NOT DELETE THIS FOLDER
===========================================================

This runs the label printing for the Silver ERP. It must stay
running for barcode printing to work on this PC.

It starts automatically every time this PC is turned on. You do
NOT need to do anything normally.

If printing ever stops working, double-click:

    START - Silver Print Agent.bat

(there is also a shortcut for it on the Desktop).

Questions: contact Pulkit.
===========================================================
"@ | Set-Content -Encoding ASCII -Path (Join-Path $InstallDir "READ ME - do not delete.txt")

$startBat = @"
@echo off
title Silver Print Agent
echo Starting Silver Print Agent...
schtasks /Run /TN "SilverPrintAgent" >nul 2>&1
if errorlevel 1 start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$AgentPath"
echo Done. Printing agent is running.
timeout /t 3 >nul
"@
Set-Content -Encoding ASCII -Path (Join-Path $InstallDir "START - Silver Print Agent.bat") -Value $startBat

# --- self-healing Scheduled Task -------------------------------------------
$taskName = "SilverPrintAgent"
$launch   = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AgentPath`""
$registered = $false
try {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $launch
  $trg1 = New-ScheduledTaskTrigger -AtLogOn
  $trg2 = New-ScheduledTaskTrigger -AtStartup
  # watchdog: also re-fire every 3 minutes; IgnoreNew below means it only starts
  # a fresh agent if the previous one has died.
  $trg3 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 3) -RepetitionDuration (New-TimeSpan -Days 3650)
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -StartWhenAvailable -RestartCount 9999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trg1,$trg2,$trg3 -Settings $settings -Principal $principal -Force | Out-Null
  $registered = $true
  Write-Host "  Auto-start + self-heal: Scheduled Task installed."
} catch {
  Write-Host "  (Scheduled Task API unavailable, using schtasks/Run key)" -ForegroundColor Yellow
}
if (-not $registered) {
  try { schtasks /Create /TN $taskName /TR "powershell $launch" /SC ONLOGON /RL LIMITED /F | Out-Null; $registered = $true } catch {}
  try { Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SilverPrintAgent" -Value "powershell $launch" } catch {}
}

# --- Desktop shortcut (clearly named) ---------------------------------------
try {
  $desktop = [Environment]::GetFolderPath("CommonDesktopDirectory")
  if (-not (Test-Path $desktop)) { $desktop = [Environment]::GetFolderPath("Desktop") }
  $lnk = Join-Path $desktop "Silver Print Agent (do not delete).lnk"
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = Join-Path $InstallDir "START - Silver Print Agent.bat"
  $sc.WorkingDirectory = $InstallDir
  $sc.Description = "Turns the Silver label-printing agent back on if it ever stops."
  $sc.Save()
  Write-Host "  Desktop shortcut created."
} catch { Write-Host "  (Could not create desktop shortcut)" -ForegroundColor Yellow }

# --- start it now -----------------------------------------------------------
try { Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue } catch {}
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$AgentPath`""

Write-Host ""
Write-Host "  DONE. The agent is running and will start automatically on every boot." -ForegroundColor Green
Write-Host "  Folder: $InstallDir"
Write-Host "  Check the ERP -> Print Bridge page: this PC should show ONLINE in ~30s."
Write-Host ""
Read-Host "  Press Enter to close"
