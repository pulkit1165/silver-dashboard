# Silver ERP - Print Agent (pure PowerShell). Installed & started by install.bat.
# Reads its token from config.json, then loops forever: heartbeat the printers,
# pull label jobs, print them raw. Self-heals (never exits) and logs to agent.log.

$ErrorActionPreference = "Continue"
$BaseUrl = "https://silver-dashboard-eight.vercel.app"
# Bump this on every agent change. The running agent compares it against the
# version in the served copy and self-updates when they differ (see TrySelfUpdate),
# so PCs pick up new agent code automatically — no manual re-install after this one.
$AgentVersion = "2026.09.10-1"
# Printer name filter. Default "TSC" (matches the TSC TTP-244 fleet). Set
# "printerFilter" in config.json to override — use "" to register EVERY printer on
# this PC (useful when the label printer isn't named "TSC"). Read below once cfg loads.
$Filter  = "TSC"
# config.json + agent.log live right next to this script (the install folder).
$Dir     = if ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { Join-Path $env:LOCALAPPDATA "SilverPrintAgent" }
$LogFile = Join-Path $Dir "agent.log"

function Log([string]$m) {
  $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "  " + $m
  try { Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue } catch {}
  Write-Host $line
}

# keep the log from growing forever
try { if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 200kb)) { Clear-Content $LogFile } } catch {}

$cfg = Get-Content (Join-Path $Dir "config.json") -Raw | ConvertFrom-Json
$Token = ("" + $cfg.token).Trim()
$Pc    = $env:COMPUTERNAME
# Honour an explicit printerFilter from config.json (including "" = all printers).
if ($cfg.PSObject.Properties['printerFilter']) { $Filter = "" + $cfg.printerFilter }
Log "=== agent starting on $Pc (base $BaseUrl) ==="
if ([string]::IsNullOrWhiteSpace($Token)) { Log "NO TOKEN in config.json - stopping"; exit 1 }

# Win32 raw-print helper. If it fails to compile we still heartbeat (printing off).
$RawOk = $true
try {
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
      try { StartPagePrinter(hp);
        IntPtr p = Marshal.AllocHGlobal(bytes.Length);
        try { Marshal.Copy(bytes, 0, p, bytes.Length); int w; if (!WritePrinter(hp, p, bytes.Length, out w)) throw new Exception("WritePrinter failed (" + Marshal.GetLastWin32Error() + ")"); }
        finally { Marshal.FreeHGlobal(p); }
        EndPagePrinter(hp);
      } finally { EndDocPrinter(hp); }
    } finally { ClosePrinter(hp); }
  }
}
"@
} catch { $RawOk = $false; Log ("Add-Type failed (printing disabled): " + $_.Exception.Message) }

function Post($path, $body) {
  $json = $body | ConvertTo-Json -Compress
  return Invoke-RestMethod -Uri "$BaseUrl$path" -Method Post -Body $json -ContentType "application/json" -Headers @{ "x-agent-token" = $Token } -TimeoutSec 20
}

# Force TLS 1.2 (older Windows defaults to TLS 1.0 and fails HTTPS to Vercel).
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

# --- self-update ---------------------------------------------------------------
# Periodically fetch the served agent script and compare its $AgentVersion to ours.
# If it changed, overwrite this file and relaunch the Scheduled Task so the new code
# runs — so a deploy reaches every PC on its own, no manual re-install. We compare
# the VERSION STRING (not the whole file) so encoding differences can't cause a
# restart loop, and we only act when the remote clearly IS our script.
function TrySelfUpdate {
  try {
    $remote = (Invoke-WebRequest -Uri "$BaseUrl/agent/SilverPrintAgent.ps1" -UseBasicParsing -TimeoutSec 20).Content
    if ([string]::IsNullOrWhiteSpace($remote) -or $remote.Length -lt 1500) { return }   # sanity: non-trivial
    if ($remote -notmatch 'Silver ERP - Print Agent') { return }                          # sanity: it's our script
    $m = [regex]::Match($remote, '\$AgentVersion\s*=\s*"([^"]+)"')
    if (-not $m.Success) { return }
    $remoteVer = $m.Groups[1].Value
    if ($remoteVer -eq $AgentVersion) { return }                                          # already current
    $selfPath = if ($PSCommandPath) { $PSCommandPath } else { Join-Path $Dir "SilverPrintAgent.ps1" }
    Set-Content -Path $selfPath -Value $remote -Encoding UTF8
    Log ("self-update: " + $AgentVersion + " -> " + $remoteVer + " installed; relaunching")
    # Detach a helper that waits for us to exit, then restarts the task with new code.
    Start-Process -WindowStyle Hidden cmd -ArgumentList '/c','ping 127.0.0.1 -n 3 >nul & schtasks /End /TN SilverPrintAgent >nul 2>&1 & schtasks /Run /TN SilverPrintAgent >nul 2>&1' | Out-Null
    exit 0
  } catch { Log ("self-update check failed: " + $_.Exception.Message) }
}

# Poll cadence. IDLE = the wait between checks when nothing is queued — this is
# the pause you feel before the FIRST label comes out (was a fixed 2500ms). ACTIVE
# = the short wait while a burst is draining, so back-to-back jobs flush fast.
# Both overridable from config.json ("pollMs" / "activePollMs") if cost needs tuning.
$IdleMs   = 700
$ActiveMs = 150
if ($cfg.PSObject.Properties['pollMs']       -and [int]$cfg.pollMs       -gt 0) { $IdleMs   = [int]$cfg.pollMs }
if ($cfg.PSObject.Properties['activePollMs'] -and [int]$cfg.activePollMs -gt 0) { $ActiveMs = [int]$cfg.activePollMs }
Log ("poll cadence: idle=" + $IdleMs + "ms  active=" + $ActiveMs + "ms")

$lastHeartbeat = (Get-Date).AddDays(-1)   # force a heartbeat on the very first loop
while ($true) {
  $printedSomething = $false
  try {
    # Heartbeat on a 30s wall-clock, independent of how fast we poll for jobs.
    if (((Get-Date) - $lastHeartbeat).TotalSeconds -ge 30) {
      $allPrinters = @(Get-Printer | Select-Object -ExpandProperty Name)
      $printers = @($allPrinters | Where-Object { $_ -like "*$Filter*" })
      Post "/api/erp/print/agent/heartbeat" @{ pc = $Pc; printers = $printers } | Out-Null
      Log ("heartbeat OK  v" + $AgentVersion + "  filter='" + $Filter + "'  registered=[" + ($printers -join ", ") + "]  allWindowsPrinters=[" + ($allPrinters -join ", ") + "]")
      $lastHeartbeat = Get-Date
      TrySelfUpdate   # pick up a newer agent version on its own (no manual re-install)
    }
    $r = Post "/api/erp/print/agent/pull" @{ pc = $Pc; limit = 10 }
    foreach ($j in @($r.jobs)) {
      $printedSomething = $true
      try {
        if (-not $RawOk) { throw "raw printing unavailable on this PC" }
        $bytes = [Convert]::FromBase64String($j.tspl_b64)
        [RawPrinter]::Send($j.name, $bytes)
        Post "/api/erp/print/agent/ack" @{ id = $j.id; ok = $true } | Out-Null
        Log ("printed job " + $j.id + " -> " + $j.name)
      } catch {
        try { Post "/api/erp/print/agent/ack" @{ id = $j.id; ok = $false; error = "$_" } | Out-Null } catch {}
        Log ("job " + $j.id + " FAILED: " + $_)
      }
    }
  } catch {
    Log ("loop error: " + $_.Exception.Message)
    Start-Sleep -Seconds 3
  }
  # Drain a burst fast; fall back to the idle cadence when the queue is empty.
  if ($printedSomething) { Start-Sleep -Milliseconds $ActiveMs } else { Start-Sleep -Milliseconds $IdleMs }
}
