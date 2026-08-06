# ============================================================================
#  Silver ERP - Print Agent (pure PowerShell, no Node.js needed).
#  Double-click "Install - Silver Print Agent.bat" to set this up. It self-installs
#  to %LOCALAPPDATA%\SilverPrintAgent, saves your token, auto-starts on login, and
#  then runs quietly: polls the ERP, prints label jobs raw to the TSC printer.
# ============================================================================

$ErrorActionPreference = "Stop"
$BaseUrl  = "https://silver-dashboard-eight.vercel.app"
$Filter   = "TSC"       # only serve printers whose name contains this
$PollMs   = 2500
$HbEvery  = 12          # heartbeat every N polls (~30s)
$InstallDir = Join-Path $env:LOCALAPPDATA "SilverPrintAgent"
$CfgFile    = Join-Path $InstallDir "config.json"
$SelfInstalled = Join-Path $InstallDir "SilverPrintAgent.ps1"

# ── first-run setup (no config yet) ─────────────────────────────────────────
if (-not (Test-Path $CfgFile)) {
  Write-Host ""
  Write-Host "  Silver ERP - Print Agent  -  first-time setup" -ForegroundColor Green
  Write-Host "  --------------------------------------------"
  $token = Read-Host "  Paste the PRINT_AGENT_TOKEN and press Enter"
  if ([string]::IsNullOrWhiteSpace($token)) { Write-Host "  No token entered. Aborting." -ForegroundColor Red; Start-Sleep 4; exit 1 }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item -Path $PSCommandPath -Destination $SelfInstalled -Force
  @{ token = $token.Trim() } | ConvertTo-Json | Set-Content -Path $CfgFile -Encoding UTF8

  # auto-start on login (per-user, hidden, no admin needed)
  $runCmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$SelfInstalled`""
  Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SilverPrintAgent" -Value $runCmd

  # launch the installed copy hidden, right now
  Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$SelfInstalled`""

  Write-Host ""
  Write-Host "  Installed. The agent is now running in the background and will" -ForegroundColor Green
  Write-Host "  auto-start every time this PC logs in."
  Write-Host ""
  Write-Host "  Next: open the ERP -> Print Barcode Labels, switch to"
  Write-Host "  'Direct (our bridge)', and this PC's TSC printer will appear."
  Write-Host ""
  Read-Host "  Press Enter to close"
  exit 0
}

# ── running instance ────────────────────────────────────────────────────────
$cfg   = Get-Content $CfgFile -Raw | ConvertFrom-Json
$Token = $cfg.token
$Pc    = $env:COMPUTERNAME

# Win32 raw-print helper (sends TSPL bytes straight to the spooler, datatype RAW).
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFOW { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFOW di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, IntPtr buf, int count, out int written);
  public static void Send(string printer, byte[] bytes) {
    IntPtr hp;
    if (!OpenPrinter(printer, out hp, IntPtr.Zero)) throw new Exception("OpenPrinter failed (" + Marshal.GetLastWin32Error() + ") for '" + printer + "'");
    try {
      DOCINFOW di = new DOCINFOW(); di.pDocName = "Silver Label"; di.pDataType = "RAW";
      if (!StartDocPrinter(hp, 1, ref di)) throw new Exception("StartDocPrinter failed (" + Marshal.GetLastWin32Error() + ")");
      try {
        StartPagePrinter(hp);
        IntPtr p = Marshal.AllocHGlobal(bytes.Length);
        try { Marshal.Copy(bytes, 0, p, bytes.Length); int written; if (!WritePrinter(hp, p, bytes.Length, out written)) throw new Exception("WritePrinter failed (" + Marshal.GetLastWin32Error() + ")"); }
        finally { Marshal.FreeHGlobal(p); }
        EndPagePrinter(hp);
      } finally { EndDocPrinter(hp); }
    } finally { ClosePrinter(hp); }
  }
}
"@

function Post($path, $body) {
  $json = $body | ConvertTo-Json -Compress
  return Invoke-RestMethod -Uri "$BaseUrl$path" -Method Post -Body $json -ContentType "application/json" -Headers @{ "x-agent-token" = $Token } -TimeoutSec 20
}
function DetectPrinters() {
  try { return @(Get-Printer | Where-Object { $_.Name -like "*$Filter*" } | Select-Object -ExpandProperty Name) } catch { return @() }
}

$tick = 0
while ($true) {
  try {
    if ($tick % $HbEvery -eq 0) {
      $printers = DetectPrinters
      Post "/api/erp/print/agent/heartbeat" @{ pc = $Pc; printers = $printers } | Out-Null
    }
    $r = Post "/api/erp/print/agent/pull" @{ pc = $Pc; limit = 10 }
    foreach ($j in @($r.jobs)) {
      try {
        $bytes = [Convert]::FromBase64String($j.tspl_b64)
        [RawPrinter]::Send($j.name, $bytes)
        Post "/api/erp/print/agent/ack" @{ id = $j.id; ok = $true } | Out-Null
      } catch {
        try { Post "/api/erp/print/agent/ack" @{ id = $j.id; ok = $false; error = "$_" } | Out-Null } catch {}
      }
    }
  } catch { Start-Sleep -Milliseconds 3000 }
  Start-Sleep -Milliseconds $PollMs
  $tick++
}
