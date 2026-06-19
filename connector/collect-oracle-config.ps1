# Silver Industries — Oracle Config Collector
# INSTRUCTIONS: Copy this file to a USB drive.
# At the client PC: right-click this file -> "Run with PowerShell"
# It will create a "silver-oracle-config" folder next to this script on the USB.

$ErrorActionPreference = "SilentlyContinue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $scriptDir "silver-oracle-config"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Silver Industries - Oracle Config Collect" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

New-Item -ItemType Directory -Path "$out\network" -Force | Out-Null
New-Item -ItemType Directory -Path "$out\client-dlls" -Force | Out-Null

# --- Find Oracle homes via registry ---
$homes = @()
foreach ($reg in @("HKLM:\SOFTWARE\Oracle", "HKLM:\SOFTWARE\WOW6432Node\Oracle")) {
    if (Test-Path $reg) {
        Get-ChildItem $reg | ForEach-Object {
            $h = (Get-ItemProperty $_.PSPath -Name ORACLE_HOME).ORACLE_HOME
            if ($h -and (Test-Path $h)) { $homes += $h }
        }
    }
}
# Also check common paths
foreach ($p in @("C:\oracle","C:\app\oracle","C:\oraclexe","C:\Oracle","C:\app")) {
    if (Test-Path $p) { $homes += $p }
}
$homes = $homes | Select-Object -Unique

if ($homes.Count -eq 0) {
    Write-Host "No Oracle home found in registry. Searching C:\ for oci.dll..." -ForegroundColor Yellow
    $ociFile = Get-ChildItem -Path "C:\" -Filter "oci.dll" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ociFile) { $homes += $ociFile.DirectoryName }
}

Write-Host "Oracle locations found: $($homes.Count)" -ForegroundColor Green
$homes | ForEach-Object { Write-Host "  $_" }
Write-Host ""

# --- Copy config files ---
Write-Host "[1/3] Copying tnsnames.ora, sqlnet.ora, ldap.ora ..." -ForegroundColor Yellow
foreach ($home in $homes) {
    foreach ($fname in @("tnsnames.ora","sqlnet.ora","ldap.ora","listener.ora")) {
        Get-ChildItem -Path $home -Filter $fname -Recurse | ForEach-Object {
            Copy-Item $_.FullName "$out\network\" -Force
            Write-Host "  Copied: $($_.FullName)"
        }
    }
    # Wallet folder
    Get-ChildItem -Path $home -Directory -Recurse | Where-Object { $_.Name -match "wallet" } | ForEach-Object {
        $dest = "$out\network\wallet"
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Copy-Item "$($_.FullName)\*" $dest -Recurse -Force
        Write-Host "  Copied wallet: $($_.FullName)"
    }
}

# --- Copy Oracle DLLs ---
Write-Host ""
Write-Host "[2/3] Copying Oracle client DLLs ..." -ForegroundColor Yellow
$copied = $false
foreach ($home in $homes) {
    $oci = Get-ChildItem -Path $home -Filter "oci.dll" -Recurse | Select-Object -First 1
    if ($oci) {
        $src = $oci.DirectoryName
        Write-Host "  Found DLLs at: $src"
        Write-Host "  Copying (may take 1-2 minutes)..."
        Copy-Item "$src\*" "$out\client-dlls\" -Recurse -Force
        Write-Host "  Done." -ForegroundColor Green
        $copied = $true
        break
    }
}
if (-not $copied) { Write-Host "  WARNING: oci.dll not found. DLLs not copied." -ForegroundColor Red }

# --- Show tnsnames.ora content ---
Write-Host ""
Write-Host "[3/3] Reading tnsnames.ora ..." -ForegroundColor Yellow
$tns = "$out\network\tnsnames.ora"
if (Test-Path $tns) {
    Write-Host ""
    Write-Host "--- tnsnames.ora ---" -ForegroundColor Cyan
    Get-Content $tns | Write-Host
} else {
    Write-Host "  tnsnames.ora not found." -ForegroundColor Red
}

# --- Done ---
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  DONE. Folder saved to:" -ForegroundColor Green
Write-Host "  $out" -ForegroundColor White
Write-Host "  Safely eject USB and bring it back." -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to close"
